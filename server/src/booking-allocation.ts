import { snackTotal, type SnackItem } from '../../shared/snacks'
import type { Prisma } from '@prisma/client'
import { enqueueBookingEmail } from './booking-email'
import { digest, randomToken } from './http'
import type { showDetails } from './inventory'

export const bookingSeats = {seats: {orderBy: {label: 'asc'}}, payment: {select: {status: true, paymentId: true}}, email: {select: {status: true}}} as const
export const referenceFor = (userId: string, requestId: string) => 'SP-' + digest(userId + ':' + requestId).slice(0, 16).toUpperCase()

export const freeHold = (now: Date) => ({OR: [{holdId: null}, {holdUntil: {lte: now}}]})

export async function createBooking(
  tx: Prisma.TransactionClient,
  show: Prisma.ShowGetPayload<{include: typeof showDetails}>,
  seats: Prisma.ShowSeatGetPayload<{include: {seat: true}}>[],
  userId: string,
  requestId: string,
  snacks: SnackItem[] = [],
) {
  const booking = await tx.booking.create({data: {
    userId, showId: show.id, requestId, reference: referenceFor(userId, requestId),
    ticketToken: randomToken(), tmdbId: show.movieId, movieTitle: show.movie.title, poster: show.movie.poster,
    cinemaName: show.screen.cinema.name, screenName: show.screen.name, startsAt: show.startsAt,
    snacks,
    total: seats.reduce((total, seat) => total + seat.price, snackTotal(snacks)),
    seats: {create: seats.map(({seat, category, price}) => ({label: seat.row + seat.number, category, price}))},
  }, include: bookingSeats})
  await enqueueBookingEmail(tx, booking)
  return booking
}
