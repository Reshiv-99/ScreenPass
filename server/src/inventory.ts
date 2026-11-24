import { Router } from 'express'
import { z } from 'zod'
import { rateLimit } from 'express-rate-limit'
import { canonicalCitySlug, prepareDemoShow } from './demo-inventory'
import { cities } from './catalogue'
import { db, HttpError } from './http'

export const id = z.string().cuid()
export const tmdbId = z.coerce.number().int().positive().max(2147483647)
export const showDetails = {
  screen: {include: {cinema: true}},
  movie: true,
} as const

export const inventory = Router()
inventory.get('/cities', (_request, response) => { response.json(cities) })
inventory.get('/cinemas', async (request, response) => {
  const citySlug = z.string().optional().parse(request.query.city)
  response.json(await db.cinema.findMany({where: {citySlug}, orderBy: {name: 'asc'}}))
})
inventory.get('/cinemas/:id', async (request, response) => {
  const cinema = await db.cinema.findUnique({where: {id: id.parse(request.params.id)}, include: {city: true, screens: true}})
  if (!cinema) throw new HttpError(404, 'Cinema not found.')
  response.json(cinema)
})
inventory.get('/cinemas/:id/screens', async (request, response) => {
  response.json(await db.screen.findMany({where: {cinemaId: id.parse(request.params.id)}, orderBy: {name: 'asc'}}))
})
inventory.get('/shows', async (request, response) => {
  const filters = z.object({city: z.string().max(32).optional(), cinema: id.optional(), movie: tmdbId.optional()}).parse(request.query)
  const citySlug = await canonicalCitySlug(filters.city)
  response.json(await db.show.findMany({
    where: {startsAt: {gt: new Date()}, movieId: filters.movie, screen: {cinemaId: filters.cinema, cinema: {citySlug}}},
    include: showDetails, orderBy: {startsAt: 'asc'}, take: 160,
  }))
})
inventory.post('/shows/demo', rateLimit({windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: {error: 'Too many seat maps opened. Please wait a minute.'}}), async (request, response) => {
  const input = z.object({movieId: tmdbId, city: z.string().min(1).max(32), startsAt: z.string().datetime()}).parse(request.body)
  response.json(await prepareDemoShow(input.movieId, input.city, input.startsAt))
})
inventory.get('/shows/:id/seats', async (request, response) => {
  const show = await db.show.findUnique({
    where: {id: id.parse(request.params.id)},
    include: {...showDetails, seats: {orderBy: [{seat: {row: 'asc'}}, {seat: {number: 'asc'}}], include: {seat: true}}},
  })
  if (!show || show.startsAt <= new Date()) throw new HttpError(404, 'This show is no longer available.')
  response.json({...show, seats: show.seats.map(({id, price, enabled, category, bookingId, holdId, holdUntil, seat}) => ({id, price, enabled, booked: !!bookingId, held: !!holdId && !!holdUntil && holdUntil > new Date(), row: seat.row, number: seat.number, category}))})
})

type Location = {id: string; name: string; address: string; lat: number; lng: number}
const discoveryCache = new Map<string, {expires: number; locations: Location[]}>()
const discoveryPending = new Map<string, Promise<Location[]>>()
let discoveryRetryAt = 0
const discoveryError = () => new HttpError(503, 'OpenStreetMap discovery is temporarily unavailable. You can still browse demo cinemas.')
async function discover(city: typeof cities[number]) {
  const cached = discoveryCache.get(city.slug)
  if (cached && cached.expires > Date.now()) return cached.locations
  if (Date.now() < discoveryRetryAt) {
    if (cached) return cached.locations
    throw discoveryError()
  }
  const pending = discoveryPending.get(city.slug)
  if (pending) return pending
  const query = `[out:json][timeout:8];nwr["amenity"="cinema"](around:18000,${city.lat},${city.lng});out center 100;`
  const fetchLocations = (async () => {
    try {
      const url = new URL(process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter')
      url.searchParams.set('data', query)
      const response = await fetch(url, {
        headers: {'User-Agent': 'ScreenPass/2.0 (cinema discovery)', Accept: 'application/json'},
        signal: AbortSignal.timeout(9000),
      })
      if (!response.ok) {
        if ([406, 429, 502, 503, 504].includes(response.status)) discoveryRetryAt = Date.now() + 30_000
        throw discoveryError()
      }
      const data = await response.json() as {elements: {type: string; id: number; tags?: Record<string, string>; lat?: number; lon?: number; center?: {lat: number; lon: number}}[]}
      const locations = data.elements.flatMap(item => {
        const lat = item.lat ?? item.center?.lat
        const lng = item.lon ?? item.center?.lon
        if (!item.tags?.name || lat === undefined || lng === undefined) return []
        const address = [item.tags['addr:street'], item.tags['addr:suburb']].filter(Boolean).join(', ')
        return [{id: `${item.type}-${item.id}`, name: item.tags.name, address, lat, lng}]
      })
      discoveryCache.set(city.slug, {expires: Date.now() + 60 * 60 * 1000, locations})
      return locations
    } catch {
      if (cached) return cached.locations
      throw discoveryError()
    } finally {
      discoveryPending.delete(city.slug)
    }
  })()
  discoveryPending.set(city.slug, fetchLocations)
  return fetchLocations
}
inventory.get('/discovery/:city', async (request, response) => {
  const city = cities.find(city => city.slug === request.params.city)
  if (!city) throw new HttpError(404, 'City not found.')
  response.json(await discover(city))
})
