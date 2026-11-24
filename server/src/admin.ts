import { Router } from 'express'
import { z } from 'zod'
import { adminOnly, publicUser, signedIn } from './auth'
import { movieDetail } from './catalogue'
import { db, HttpError } from './http'
import { demoSeatPrices, seatLayout } from './seat-layout'
import { id, showDetails, tmdbId } from './inventory'

export const admin = Router()
admin.use(signedIn, adminOnly)
const shortText = z.string().trim().min(1).max(120)
const cinema = z.object({name: shortText, address: shortText, citySlug: z.string().trim().min(1).max(32), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180)})
const screen = z.object({name: shortText, cinemaId: id, rows: z.number().int().min(1).max(26), seatsPerRow: z.number().int().min(1).max(30), premiumRows: z.number().int().min(0).max(26)}).refine(data => data.premiumRows <= data.rows, 'Premium rows must fit within the screen.')
const show = z.object({screenId: id, movieId: tmdbId, startsAt: z.coerce.date(), endsAt: z.coerce.date(), standardPrice: z.number().int().min(0).max(1000000), premiumPrice: z.number().int().min(0).max(1000000), reclinerPrice: z.number().int().min(0).max(1000000).default(demoSeatPrices.RECLINER)})
  .refine(data => data.startsAt > new Date() && data.endsAt > data.startsAt, 'Enter future show times with the end after the start.')


admin.get('/overview', async (_request, response) => {
  const [bookings, users, cinemas, movies, shows] = await Promise.all([
    db.booking.count(), db.user.count(), db.cinema.count(), db.movie.count(), db.show.count({where: {startsAt: {gt: new Date()}}}),
  ])
  response.json({bookings, users, cinemas, movies, shows})
})
admin.get('/bookings', async (_request, response) => {
  response.json(await db.booking.findMany({select: {reference: true, movieTitle: true, startsAt: true, total: true, status: true}, orderBy: {createdAt: 'desc'}, take: 100}))
})
admin.get('/payments', async (_request, response) => {
  const attempts = await db.paymentAttempt.findMany({
    orderBy: {createdAt: 'desc'}, take: 100,
    select: {id: true, orderId: true, paymentId: true, status: true, amountPaise: true, expiresAt: true,
      booking: {select: {reference: true}}, show: {select: {movie: {select: {title: true}}}}},
  })
  response.json(attempts)
})
admin.get('/users', async (request, response) => {
  const email = z.string().trim().email().max(254).toLowerCase().optional().parse(request.query.email)
  response.json(await db.user.findMany({where: {email}, select: publicUser, orderBy: {createdAt: 'desc'}, take: 100}))
})
admin.patch('/users/:id/role', async (request, response) => {
  if (request.user!.role !== 'OWNER') throw new HttpError(403, 'Only the owner can manage staff access.')
  const userId = id.parse(request.params.id)
  const {role} = z.object({role: z.enum(['CUSTOMER', 'ADMIN'])}).parse(request.body)
  const result = await db.user.updateMany({where: {id: userId, role: {not: 'OWNER'}}, data: {role}})
  if (!result.count) throw new HttpError(409, 'This account is unavailable for role changes.')
  response.sendStatus(204)
})
admin.get('/screens', async (_request, response) => {
  response.json(await db.screen.findMany({include: {cinema: true, seats: {orderBy: [{row: 'asc'}, {number: 'asc'}]}}, orderBy: {name: 'asc'}}))
})
admin.get('/shows', async (request, response) => {
  const upcoming = request.query.upcoming === '1'
  response.json(await db.show.findMany({
    where: upcoming ? {startsAt: {gt: new Date()}} : undefined,
    include: {...showDetails, seats: {distinct: ['category'], select: {price: true, category: true}}},
    orderBy: {startsAt: upcoming ? 'asc' : 'desc'}, take: upcoming ? 4 : 80,
  }))
})
admin.get('/movies', async (_request, response) => {
  response.json(await db.movie.findMany({include: {cinemas: true}, orderBy: {title: 'asc'}}))
})
admin.post('/movies', async (request, response) => {
  const {movieId, cinemaId} = z.object({movieId: tmdbId, cinemaId: id}).parse(request.body)
  const film = await movieDetail(movieId)
  await db.$transaction([
    db.movie.upsert({where: {tmdbId: movieId}, update: {title: film.title, poster: film.poster_path}, create: {tmdbId: movieId, title: film.title, poster: film.poster_path}}),
    db.cinemaMovie.upsert({where: {cinemaId_movieId: {cinemaId, movieId}}, update: {}, create: {cinemaId, movieId}}),
  ])
  response.sendStatus(201)
})
admin.post('/cinemas', async (request, response) => { response.status(201).json(await db.cinema.create({data: cinema.parse(request.body)})) })
admin.patch('/cinemas/:id', async (request, response) => { response.json(await db.cinema.update({where: {id: id.parse(request.params.id)}, data: cinema.parse(request.body)})) })
admin.delete('/cinemas/:id', async (request, response) => { await db.cinema.delete({where: {id: id.parse(request.params.id)}}); response.sendStatus(204) })
admin.post('/screens', async (request, response) => {
  const data = screen.parse(request.body)
  response.status(201).json(await db.screen.create({data: {name: data.name, cinemaId: data.cinemaId, seats: {create: seatLayout(data.rows, data.seatsPerRow, data.premiumRows)}}}))
})
admin.patch('/screens/:id', async (request, response) => {
  response.json(await db.screen.update({where: {id: id.parse(request.params.id)}, data: {name: shortText.parse(request.body?.name)}}))
})
admin.delete('/screens/:id', async (request, response) => { await db.screen.delete({where: {id: id.parse(request.params.id)}}); response.sendStatus(204) })
admin.patch('/seats/:id', async (request, response) => {
  const data = z.object({category: z.enum(['STANDARD', 'PREMIUM', 'RECLINER']), enabled: z.boolean()}).parse(request.body)
  const seat = await db.seat.update({where: {id: id.parse(request.params.id)}, data})
  response.json(seat)
})

async function saveShow(input: z.infer<typeof show>, showId?: string) {
  return db.$transaction(async tx => {
    // Serialize schedule changes for a screen before checking overlap.
    const locked = await tx.$queryRaw<{id: string}[]>`SELECT id FROM Screen WHERE id = ${input.screenId} FOR UPDATE`
    if (!locked.length) throw new HttpError(404, 'Screen not found.')
    if (showId) {
      await tx.$queryRaw`SELECT id FROM \`Show\` WHERE id = ${showId} FOR UPDATE`
      const current = await tx.show.findUniqueOrThrow({where: {id: showId}, include: {_count: {select: {bookings: true}}}})
      const holds = await tx.showSeat.count({where: {showId, holdId: {not: null}, holdUntil: {gt: new Date()}}})
      if (holds) throw new HttpError(409, 'This show has seats held for checkout.')
      if (current._count.bookings || current.startsAt <= new Date()) throw new HttpError(409, 'This show has bookings or has already started.')
      if (current.screenId !== input.screenId) throw new HttpError(409, 'Create a new show to use a different screen.')
    }
    const overlap = await tx.show.findFirst({where: {id: showId ? {not: showId} : undefined, screenId: input.screenId, startsAt: {lt: input.endsAt}, endsAt: {gt: input.startsAt}}})
    if (overlap) throw new HttpError(409, 'This screen already has a show during that time.')
    const screen = await tx.screen.findUniqueOrThrow({where: {id: input.screenId}, include: {seats: true}})
    const {standardPrice, premiumPrice, reclinerPrice, ...data} = input
    const prices = {STANDARD: standardPrice, PREMIUM: premiumPrice, RECLINER: reclinerPrice}
    await tx.cinemaMovie.upsert({where: {cinemaId_movieId: {cinemaId: screen.cinemaId, movieId: data.movieId}}, create: {cinemaId: screen.cinemaId, movieId: data.movieId}, update: {}})
    const seats = screen.seats.map(seat => ({seatId: seat.id, category: seat.category, enabled: seat.enabled, price: prices[seat.category]}))
    if (showId) {
      await tx.showSeat.deleteMany({where: {showId}})
      return tx.show.update({where: {id: showId}, data: {...data, seats: {create: seats}}})
    }
    return tx.show.create({data: {...data, seats: {create: seats}}})
  }, {isolationLevel: 'ReadCommitted'})
}
admin.post('/shows', async (request, response) => { response.status(201).json(await saveShow(show.parse(request.body))) })
admin.patch('/shows/:id', async (request, response) => { response.json(await saveShow(show.parse(request.body), id.parse(request.params.id))) })
admin.delete('/shows/:id', async (request, response) => {
  await db.show.delete({where: {id: id.parse(request.params.id)}})
  response.sendStatus(204)
})
