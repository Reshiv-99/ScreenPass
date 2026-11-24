import type { Prisma } from '@prisma/client'
import { appOrigin, db } from './http'
import { ticketDate, ticketPdf } from './ticket-pdf'

const maxAttempts = 5
const retryDelay = [60_000, 300_000, 900_000, 3_600_000]
const leaseMs = 120_000
const maxAgeMs = 20 * 60 * 60_000

function emailConfig() {
  const token = process.env.RESEND_API_KEY?.trim()
  const from = process.env.BOOKING_EMAIL_FROM?.trim()
  return token && from ? {token, from} : null
}

export async function enqueueBookingEmail(tx: Prisma.TransactionClient, booking: {id: string; userId: string; ticketToken: string}) {
  if (!emailConfig()) return
  const user = await tx.user.findUniqueOrThrow({where: {id: booking.userId}, select: {email: true}})
  await tx.bookingEmail.create({data: {
    bookingId: booking.id,
    recipient: user.email,
    verificationUrl: new URL('/verify/' + booking.ticketToken, appOrigin()).href,
  }})
}

export async function deliverBookingEmails() {
  const config = emailConfig()
  if (!config) return
  const now = new Date()
  const oldest = new Date(+now - maxAgeMs)
  await db.bookingEmail.updateMany({where: {
    status: 'PENDING', nextAttemptAt: {lte: now}, OR: [{createdAt: {lte: oldest}}, {attempts: {gte: maxAttempts}}],
  }, data: {status: 'FAILED'}})
  const jobs = await db.bookingEmail.findMany({
    where: {status: 'PENDING', attempts: {lt: maxAttempts}, nextAttemptAt: {lte: now}},
    orderBy: {nextAttemptAt: 'asc'}, take: 10,
    include: {booking: {include: {seats: {orderBy: {label: 'asc'}}}}},
  })
  await Promise.all(jobs.map(async job => {
    const claimed = await db.bookingEmail.updateMany({
      where: {bookingId: job.bookingId, status: 'PENDING', attempts: job.attempts, nextAttemptAt: {lte: now}},
      data: {attempts: {increment: 1}, nextAttemptAt: new Date(Date.now() + leaseMs)},
    })
    if (!claimed.count) return
    const attempt = job.attempts + 1
    const where = {bookingId: job.bookingId, status: 'PENDING' as const, attempts: attempt}
    try {
      const ticket = job.booking
      const current = await db.booking.findUnique({where: {id: job.bookingId}, select: {status: true}})
      if (current?.status !== 'CONFIRMED') {
        await db.bookingEmail.updateMany({where, data: {status: 'SKIPPED'}})
        return
      }
      const attachment = await ticketPdf(ticket, job.verificationUrl)
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + config.token,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'cinevault-ticket/' + job.bookingId,
        },
        body: JSON.stringify({
          from: config.from,
          to: [job.recipient],
          subject: 'ScreenPass booking confirmed | ' + ticket.reference,
          text: [
            'Your ScreenPass demo booking is confirmed. Your QR ticket is attached.',
            ticket.movieTitle, ticket.cinemaName, ticketDate(ticket.startsAt),
            'Seats: ' + ticket.seats.map(seat => seat.label).join(', '),
            'Booking reference: ' + ticket.reference,
            'No real payment was collected.',
            'Verify ticket: ' + job.verificationUrl,
          ].join('\n\n'),
          attachments: [{filename: 'ScreenPass-' + ticket.reference + '.pdf', content: attachment.toString('base64')}],
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new Error('Email provider rejected the request.')
      await db.bookingEmail.updateMany({where, data: {status: 'SENT', sentAt: new Date()}})
    } catch {
      await db.bookingEmail.updateMany({where, data: attempt >= maxAttempts
        ? {status: 'FAILED'} : {nextAttemptAt: new Date(Date.now() + retryDelay[attempt - 1])}})
      console.warn('Booking confirmation email attempt failed.')
    }
  }))
}

export function startBookingEmailWorker() {
  let active: Promise<void> | undefined
  function tick() {
    active ??= deliverBookingEmails()
      .catch(() => console.warn('Booking confirmation email queue could not be processed.'))
      .finally(() => {active = undefined})
  }
  if (!emailConfig()) return async () => {}
  tick()
  const timer = setInterval(tick, 10_000)
  timer.unref()
  return async () => {clearInterval(timer); await active}
}
