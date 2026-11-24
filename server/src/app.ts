import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { admin } from './admin'
import { auth, readUser, signedIn } from './auth'
import { bookings, tickets } from './bookings'
import { movieDetail, movieGenres, movieList, publicMovieDetail } from './catalogue'
import { appOrigin, db, handleError, HttpError } from './http'
import { inventory, tmdbId } from './inventory'
import { payments, paymentWebhook } from './payments'

export const app = express()
if (process.env.VERCEL === '1') app.set('trust proxy', 1)
app.disable('x-powered-by')
app.use(cors({origin: appOrigin(), credentials: true}))
app.use((_request, response, next) => {
  response.set('X-Content-Type-Options', 'nosniff')
  response.set('Referrer-Policy', 'no-referrer')
  response.set('Cache-Control', 'no-store')
  next()
})
app.post('/api/payments/webhook', express.raw({type: 'application/json', limit: '64kb'}), paymentWebhook)
app.use(express.json({limit: '32kb'}), cookieParser())
app.use('/api', (request, _response, next) => {
  const origin = request.get('origin')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && origin && origin !== appOrigin()) {
    throw new HttpError(403, 'This request came from a different site.')
  }
  next()
})
app.get('/api/health', (_request, response) => { response.json({status: 'ok'}) })
app.use('/api/movies', rateLimit({windowMs: 60_000, limit: 150, standardHeaders: 'draft-8', legacyHeaders: false}))
app.get('/api/movies/genres', async (_request, response) => { response.json(await movieGenres()) })
app.get('/api/movies/list/:kind', async (request, response) => {
  const {q, page, genre} = z.object({q: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).max(500).default(1), genre: z.coerce.number().int().positive().max(10000).optional()}).parse(request.query)
  response.json(await movieList(request.params.kind, q, page, genre))
})
app.get('/api/movies/:id', async (request, response) => { response.json(await publicMovieDetail(tmdbId.parse(request.params.id))) })
app.get('/api/movies/:id/:section', async (request, response) => {
  const section = z.enum(['credits', 'videos']).parse(request.params.section)
  const movie = await publicMovieDetail(tmdbId.parse(request.params.id), false)
  response.json(movie[section] ?? (section === 'credits' ? {cast: [], crew: []} : {results: []}))
})
app.use('/api/tickets', tickets)
app.use('/api', inventory)
app.use('/api/auth', readUser, auth)
app.use('/api/payments', readUser, payments)
app.use('/api/bookings', readUser, bookings)
app.use('/api/admin', readUser, admin)

app.get('/api/notifications', readUser, signedIn, async (request, response) => {
  const date = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Kolkata'}).format(new Date())
  const records = await db.notification.findMany({where: {userId: request.user!.id}, orderBy: {createdAt: 'desc'}})
  response.json(records.map(record => ({...record, released: !!record.releaseDate && record.releaseDate <= date})))
})
app.post('/api/notifications/:id', readUser, signedIn, async (request, response) => {
  const id = tmdbId.parse(request.params.id)
  const movie = await movieDetail(id)
  const userId = request.user!.id
  const details = {title: movie.title, releaseDate: movie.india_release_date || movie.release_date || null}
  response.status(201).json(await db.notification.upsert({where: {userId_tmdbId: {userId, tmdbId: id}}, create: {...details, userId, tmdbId: id}, update: details}))
})
app.delete('/api/notifications/:id', readUser, signedIn, async (request, response) => {
  await db.notification.deleteMany({where: {userId: request.user!.id, tmdbId: tmdbId.parse(request.params.id)}})
  response.sendStatus(204)
})
app.use((_request, response) => { response.status(404).json({error: 'API route not found.'}) })
app.use(handleError)
