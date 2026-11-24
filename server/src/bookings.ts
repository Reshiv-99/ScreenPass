import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { rateLimit } from 'express-rate-limit'
import QRCode from 'qrcode'
import { z } from 'zod'
import { signedIn } from './auth'
import { appOrigin, db, HttpError } from './http'
import { priceSnacks, sameSnacks, snackChoices } from '../../shared/snacks'
import { bookingSeats as include, createBooking, freeHold, referenceFor } from './booking-allocation'
import { paymentMode } from './razorpay'
import { id, showDetails } from './inventory'

type BookingWithSeats = Prisma.BookingGetPayload<{include: typeof include}>
const cutoffMs = 30 * 60 * 1000

function publicBooking({ticketToken: _ticketToken, requestId: _requestId, userId: _userId, ...booking}: BookingWithSeats) {
  return {...booking, canCancel: booking.status === 'CONFIRMED' && booking.startsAt.getTime() > Date.now() + cutoffMs}
}

const bookingInput = z.object({showId: id, seatIds: z.array(id).min(1).max(10), requestId: z.string().uuid(), snacks: snackChoices.default([])})
const reference = z.string().regex(/^(?:SP|CV)-[A-F0-9]{16}$/)
export const bookings = Router()
bookings.use(signedIn)
bookings.get('/', async (request, response) => {
  const records = await db.booking.findMany({where: {userId: request.user!.id}, include, orderBy: {startsAt: 'desc'}})
  response.json(records.map(publicBooking))
})
bookings.post('/', async (request, response) => {
  if (paymentMode() !== 'demo') throw new HttpError(409, 'Use the test payment checkout to confirm this booking.')
  const {showId, seatIds, requestId, snacks: choices} = bookingInput.parse(request.body)
  const snacks = priceSnacks(choices)
  if (new Set(seatIds).size !== seatIds.length) throw new HttpError(400, 'Select each seat once.')
  const userId = request.user!.id
  const existing = () => db.booking.findUnique({where: {userId_requestId: {userId, requestId}}, include})
  const replay = async () => {
    const booking = await existing()
    if (!booking) return null
    const requested = await db.showSeat.findMany({where: {showId, id: {in: seatIds}}, include: {seat: true}})
    const labels = new Set(booking.seats.map(seat => seat.label))
    if (!sameSnacks(booking.snacks, snacks) || booking.showId !== showId || seatIds.length !== labels.size || requested.length !== labels.size || requested.some(({seat}) => !labels.has(seat.row + seat.number))) {
      throw new HttpError(409, 'This request ID belongs to a different booking.')
    }
    return publicBooking(booking)
  }
  const prior = await replay()
  if (prior) { response.json(prior); return }
  try {
    const booking = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM \`Show\` WHERE id = ${showId} LOCK IN SHARE MODE`
      const show = await tx.show.findUnique({where: {id: showId}, include: showDetails})
      if (!show || show.startsAt <= new Date()) throw new HttpError(404, 'This show is no longer available.')
      const seats = await tx.showSeat.findMany({where: {showId, id: {in: seatIds}}, include: {seat: true}})
      if (seats.length !== seatIds.length || seats.some(seat => !seat.enabled || seat.bookingId)) {
        throw new HttpError(409, 'One or more seats are unavailable. Pick different seats.')
      }
      const record = await createBooking(tx, show, seats, userId, requestId, snacks)
      // MySQL rechecks the allocation predicate after waiting on competing row updates.
      const claimed = await tx.showSeat.updateMany({where: {showId, id: {in: seatIds}, enabled: true, bookingId: null, ...freeHold(new Date())}, data: {bookingId: record.id, holdId: null, holdUntil: null}})
      if (claimed.count !== seatIds.length) throw new HttpError(409, 'One or more seats were just taken. Pick different seats.')
      return record
    }, {isolationLevel: 'ReadCommitted'})
    response.status(201).json(publicBooking(booking))
  } catch (error) {
    const prior = await replay()
    if (!prior) throw error
    response.json(prior)
  }
})

async function ownBooking(userId: string, value: unknown) {
  const booking = await db.booking.findFirst({where: {reference: reference.parse(value), userId}, include})
  if (!booking) throw new HttpError(404, 'Booking not found.')
  return booking
}

bookings.get('/requests/:requestId', async (request, response) => {
  const requestId = z.string().uuid().parse(request.params.requestId)
  const userId = request.user!.id
  const booking = await db.booking.findUnique({where: {userId_requestId: {userId, requestId}}, select: {reference: true}})
  response.json({reference: booking?.reference ?? referenceFor(userId, requestId), submitted: !!booking})
})

bookings.get('/:reference', async (request, response) => {
  response.json(publicBooking(await ownBooking(request.user!.id, request.params.reference)))
})
bookings.post('/:reference/cancel', async (request, response) => {
  const booking = await ownBooking(request.user!.id, request.params.reference)
  const result = await db.$transaction(async tx => {
    const now = new Date()
    const changed = await tx.booking.updateMany({
      where: {id: booking.id, status: 'CONFIRMED', startsAt: {gt: new Date(now.getTime() + cutoffMs)}},
      data: {status: 'CANCELLED', cancelledAt: now},
    })
    if (!changed.count) throw new HttpError(409, 'Only confirmed bookings more than 30 minutes before showtime can be cancelled.')
    await tx.showSeat.updateMany({where: {bookingId: booking.id}, data: {bookingId: null}})
    return tx.booking.findUniqueOrThrow({where: {id: booking.id}, include})
  })
  response.json(publicBooking(result))
})
bookings.get('/:reference/ticket', async (request, response) => {
  const booking = await ownBooking(request.user!.id, request.params.reference)
  const verificationUrl = new URL('/verify/' + booking.ticketToken, appOrigin()).href
  const qr = booking.status === 'CONFIRMED' ? await QRCode.toDataURL(verificationUrl, {width: 256, margin: 2}) : null
  response.json({...publicBooking(booking), qr})
})

export const tickets = Router()
tickets.use(rateLimit({windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false}))
tickets.get('/verify/:token', async (request, response) => {
  const token = z.string().regex(/^[a-f0-9]{64}$/).safeParse(request.params.token)
  const booking = token.success ? await db.booking.findUnique({where: {ticketToken: token.data}, select: {status: true, reference: true}}) : null
  if (!booking) { response.status(404).json({status: 'INVALID', error: 'This ticket is invalid.'}); return }
  response.json({status: booking.status === 'CONFIRMED' ? 'VALID' : 'CANCELLED', reference: booking.reference})
})
