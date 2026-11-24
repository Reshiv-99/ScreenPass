import { Router, type RequestHandler } from 'express'
import { Prisma, type PaymentAttempt } from '@prisma/client'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { signedIn } from './auth'
import { priceSnacks, sameSnacks, snackChoices, snackTotal, type SnackItem } from '../../shared/snacks'
import { createBooking, freeHold } from './booking-allocation'
import { db, HttpError } from './http'
import { id, showDetails } from './inventory'
import { paymentMode, razorpayConfig, razorpayRequest, signatureMatches } from './razorpay'

const requestIdSchema = z.string().uuid()
const seatIdsSchema = z.array(id).min(1).max(10)
const orderIdSchema = z.string().regex(/^order_[a-zA-Z0-9]{1,40}$/)
const paymentIdSchema = z.string().regex(/^pay_[a-zA-Z0-9]{1,40}$/)
const captureSchema = z.object({id: paymentIdSchema, order_id: orderIdSchema, amount: z.number().int(), currency: z.string(), status: z.string()})
type Capture = z.infer<typeof captureSchema>
const holdDuration = 10 * 60_000

async function reserve(userId: string, showId: string, requestId: string, seatIds: string[], snacks: SnackItem[]) {
  const where = {userId_requestId: {userId, requestId}}
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM \`Show\` WHERE id = ${showId} LOCK IN SHARE MODE`
      const existing = await tx.paymentAttempt.findUnique({where})
      if (existing) return {attempt: existing, created: false}
      const now = new Date()
      const show = await tx.show.findUnique({where: {id: showId}, select: {startsAt: true}})
      if (!show || show.startsAt <= now) throw new HttpError(404, 'This show is no longer available.')
      const available = {showId, id: {in: seatIds}, enabled: true, bookingId: null, ...freeHold(now)}
      const seats = await tx.showSeat.findMany({where: available})
      if (seats.length !== seatIds.length) throw new HttpError(409, 'Some seats are booked or held by another customer.')
      const amountPaise = seats.reduce((total, seat) => total + seat.price * 100, snackTotal(snacks) * 100)
      if (amountPaise < 100 || amountPaise > 2147483647) throw new HttpError(400, 'This amount is unavailable for test checkout.')
      const expiresAt = new Date(Math.min(+now + holdDuration, +show.startsAt))
      const attempt = await tx.paymentAttempt.create({data: {userId, showId, requestId, seatIds, snacks, amountPaise, expiresAt}})
      const claimed = await tx.showSeat.updateMany({where: available, data: {holdId: attempt.id, holdUntil: expiresAt}})
      if (claimed.count !== seats.length) throw new HttpError(409, 'Some seats were just held. Please choose again.')
      return {attempt, created: true}
    }, {isolationLevel: 'ReadCommitted'})
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error
    const attempt = await db.paymentAttempt.findUnique({where})
    if (!attempt) throw error
    return {attempt, created: false}
  }
}

function checkSelection(attempt: PaymentAttempt, showId: string, seatIds: string[], snacks: SnackItem[]) {
  const saved = seatIdsSchema.parse(attempt.seatIds)
  if (!sameSnacks(attempt.snacks, snacks) || attempt.showId !== showId || saved.length !== seatIds.length || seatIds.some(id => !saved.includes(id))) {
    throw new HttpError(409, 'This checkout request belongs to a different seat selection.')
  }
}

async function failOrder(attemptId: string) {
  await db.$transaction(async tx => {
    const changed = await tx.paymentAttempt.updateMany({where: {id: attemptId, status: 'HOLD', orderId: null}, data: {status: 'FAILED'}})
    if (changed.count) await tx.showSeat.updateMany({where: {holdId: attemptId}, data: {holdId: null, holdUntil: null}})
  })
}

async function finalize(orderId: string, capture: Capture) {
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM PaymentAttempt WHERE orderId = ${orderId} FOR UPDATE`
    const attempt = await tx.paymentAttempt.findUnique({where: {orderId}, include: {booking: {select: {reference: true}}}})
    if (!attempt) return {status: 'unknown'} as const
    if (capture.order_id !== orderId || capture.amount !== attempt.amountPaise || capture.currency !== 'INR' || capture.status !== 'captured') {
      throw new HttpError(409, 'The payment service has not confirmed the expected payment.')
    }
    if (attempt.status === 'CONFIRMED' && attempt.booking) return {status: 'confirmed', reference: attempt.booking.reference} as const
    if (attempt.status === 'REVIEW') return {status: 'review'} as const
    const now = new Date()
    const seatIds = seatIdsSchema.parse(attempt.seatIds)
    const snacks = (attempt.snacks ?? []) as SnackItem[]
    const held = {showId: attempt.showId, id: {in: seatIds}, holdId: attempt.id, holdUntil: {gt: now}, enabled: true, bookingId: null}
    await tx.$queryRaw`SELECT id FROM \`Show\` WHERE id = ${attempt.showId} LOCK IN SHARE MODE`
    const show = await tx.show.findUnique({where: {id: attempt.showId}, include: showDetails})
    const seats = await tx.showSeat.findMany({where: held, include: {seat: true}})
    if (attempt.status !== 'HOLD' || attempt.expiresAt <= now || !show || show.startsAt <= now || seats.length !== seatIds.length
      || seats.reduce((total, seat) => total + seat.price * 100, snackTotal(snacks) * 100) !== attempt.amountPaise) {
      await tx.paymentAttempt.update({where: {id: attempt.id}, data: {status: 'REVIEW', paymentId: capture.id}})
      await tx.showSeat.updateMany({where: {holdId: attempt.id}, data: {holdId: null, holdUntil: null}})
      return {status: 'review'} as const
    }
    const booking = await createBooking(tx, show, seats, attempt.userId, attempt.requestId, snacks)
    const claimed = await tx.showSeat.updateMany({where: held, data: {bookingId: booking.id, holdId: null, holdUntil: null}})
    if (claimed.count !== seats.length) throw new HttpError(409, 'Seat availability changed while confirming the payment.')
    await tx.paymentAttempt.update({where: {id: attempt.id}, data: {status: 'CONFIRMED', paymentId: capture.id, bookingId: booking.id}})
    return {status: 'confirmed', reference: booking.reference} as const
  }, {isolationLevel: 'ReadCommitted'})
  return result
}

const providerOrder = z.object({id: orderIdSchema, amount: z.number().int(), currency: z.literal('INR')})
const providerPayments = z.object({items: z.array(captureSchema)})
async function reconcile(attempt: PaymentAttempt) {
  if (!attempt.orderId) return null
  const {items} = providerPayments.parse(await razorpayRequest('/orders/' + attempt.orderId + '/payments'))
  const captured = items.find(payment => payment.status === 'captured')
  return captured ? finalize(attempt.orderId, captured) : null
}

export const payments = Router()
payments.get('/config', (_request, response) => { response.json({mode: paymentMode()}) })
payments.use(signedIn, rateLimit({windowMs: 60_000, limit: 35, standardHeaders: 'draft-8', legacyHeaders: false}))
payments.post('/orders', async (request, response) => {
  const config = razorpayConfig()
  const input = z.object({showId: id, requestId: requestIdSchema, seatIds: seatIdsSchema, snacks: snackChoices.default([])}).parse(request.body)
  if (new Set(input.seatIds).size !== input.seatIds.length) throw new HttpError(400, 'Select each seat once.')
  const snacks = priceSnacks(input.snacks)
  const {attempt, created} = await reserve(request.user!.id, input.showId, input.requestId, input.seatIds, snacks)
  checkSelection(attempt, input.showId, input.seatIds, snacks)
  let orderId = attempt.orderId
  if (!created) {
    if (attempt.status === 'CONFIRMED' && attempt.bookingId) {
      const booking = await db.booking.findUniqueOrThrow({where: {id: attempt.bookingId}, select: {reference: true}})
      response.json({status: 'confirmed', reference: booking.reference})
      return
    }
    if (attempt.status === 'REVIEW') {
      response.json({status: 'review'})
      return
    }
    if (orderId) {
      const recovered = await reconcile(attempt)
      if (recovered) {response.json(recovered); return}
    }
    if (attempt.status !== 'HOLD' || attempt.expiresAt <= new Date()) {
      response.json({status: 'expired'})
      return
    }
    if (!orderId) throw new HttpError(409, 'Checkout is being prepared. Try again in a moment.')
  } else {
    try {
      const raw = await razorpayRequest('/orders', {amount: attempt.amountPaise, currency: 'INR', receipt: attempt.id})
      const order = providerOrder.parse(raw)
      if (order.amount !== attempt.amountPaise) throw new HttpError(502, 'The payment service returned an unexpected amount.')
      orderId = order.id
      await db.paymentAttempt.update({where: {id: attempt.id}, data: {orderId}})
    } catch (error) {
      await failOrder(attempt.id)
      throw error
    }
  }
  response.json({status: 'ready', orderId, keyId: config.keyId, amount: attempt.amountPaise, expiresAt: attempt.expiresAt})
})

payments.post('/verify', async (request, response) => {
  const config = razorpayConfig()
  const {orderId, paymentId, signature} = z.object({orderId: orderIdSchema, paymentId: paymentIdSchema, signature: z.string().max(64)}).parse(request.body)
  const attempt = await db.paymentAttempt.findFirst({where: {orderId, userId: request.user!.id}})
  if (!attempt) throw new HttpError(404, 'Payment order not found.')
  if (!signatureMatches(orderId + '|' + paymentId, signature, config.secret)) throw new HttpError(400, 'Payment signature could not be verified.')
  const capture = captureSchema.parse(await razorpayRequest('/payments/' + paymentId))
  if (capture.id !== paymentId || capture.order_id !== orderId || capture.amount !== attempt.amountPaise || capture.currency !== 'INR') {
    throw new HttpError(409, 'The payment service returned a payment that does not match this order.')
  }
  if (capture.status !== 'captured') {response.status(202).json({status: 'pending'}); return}
  response.json(await finalize(orderId, capture))
})

payments.post('/recover', async (request, response) => {
  razorpayConfig()
  const {requestId} = z.object({requestId: requestIdSchema}).parse(request.body)
  const attempt = await db.paymentAttempt.findUnique({where: {userId_requestId: {userId: request.user!.id, requestId}}})
  const result = attempt ? await reconcile(attempt) : null
  response.json(result ?? {status: 'pending'})
})

export const paymentWebhook: RequestHandler = async (request, response) => {
  razorpayConfig()
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
  if (!secret) throw new HttpError(503, 'Razorpay webhooks are not configured.')
  if (!Buffer.isBuffer(request.body) || !signatureMatches(request.body, request.get('x-razorpay-signature') ?? '', secret)) {
    throw new HttpError(400, 'Invalid webhook signature.')
  }
  const event = z.object({event: z.string(), payload: z.unknown()}).parse(JSON.parse(request.body.toString('utf8')))
  if (event.event === 'payment.captured') {
    const {payment} = z.object({payment: z.object({entity: captureSchema})}).parse(event.payload)
    await finalize(payment.entity.order_id, payment.entity)
  }
  response.sendStatus(204)
}
