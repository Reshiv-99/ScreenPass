import { readFile } from 'node:fs/promises'
import { Prisma } from '@prisma/client'
import { demoShowtimes } from '../../web/src/demo-showtimes'
import { normalizeCityName } from '../../web/src/location'
import { cities, publicMovieDetail } from './catalogue'
import { db, HttpError } from './http'
import { releaseWindow } from './releases'
import { demoSeatLayout, demoSeatPrices } from './seat-layout'

type Place = [id: string, name: string, state: string, lat: number, lng: number]
let places: Promise<Place[]> | undefined
async function resolveCity(slug: string) {
  const preset = cities.find(city => city.slug === slug)
  if (preset) return {...preset, label: preset.name}
  if (!slug.startsWith('custom-')) return null
  places ??= readFile(new URL('../../web/public/data/indian-cities.json', import.meta.url), 'utf8')
    .then(data => JSON.parse(data) as Place[])
    .catch(error => { places = undefined; throw error })
  const catalogue = await places
  const key = slug.slice('custom-'.length)
  const place = catalogue.find(([id, name]) => id === key || Array.from(normalizeCityName(name)).slice(0, 12).join('') === key)
  if (!place) return null
  const [, label, state] = place
  const [id, , , lat, lng] = catalogue.find(([, name, region]) => name === label && region === state)!
  return {slug: 'custom-' + id, name: state ? label + ', ' + state : label, label, lat, lng}
}

export async function canonicalCitySlug(slug?: string) {
  if (!slug?.startsWith('custom-')) return slug
  return (await resolveCity(slug))?.slug ?? slug
}

export async function prepareDemoShow(movieId: number, citySlug: string, startsAt: string) {
  if (!demoShowtimes().includes(startsAt)) throw new HttpError(409, 'That demo time is no longer available. Choose another showtime.')
  const city = await resolveCity(citySlug)
  if (!city) throw new HttpError(404, 'Choose an Indian city from the city search to open its seat map.')
  const movie = await publicMovieDetail(movieId)
  if (!movie.india_release_date || movie.india_release_date > releaseWindow().today) {
    throw new HttpError(409, 'Demo seat selection opens on the India theatrical release date.')
  }

  const start = new Date(startsAt)
  const duration = movie.runtime && movie.runtime > 0 ? movie.runtime + 15 : 150
  const venueName = 'ScreenPass Demo Cinema · ' + city.label
  const screenName = 'Demo Auditorium ' + movie.id
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        if (start <= new Date()) throw new HttpError(409, 'That demo show has already started.')
        await tx.city.createMany({data: {slug: city.slug, name: city.name, lat: city.lat, lng: city.lng}, skipDuplicates: true})
        await tx.movie.createMany({data: {tmdbId: movie.id, title: movie.title, poster: movie.poster_path}, skipDuplicates: true})
        await tx.cinema.createMany({data: {name: venueName, address: city.name + ' · Simulated venue', citySlug: city.slug, lat: city.lat, lng: city.lng}, skipDuplicates: true})
        const cinema = await tx.cinema.findUniqueOrThrow({where: {citySlug_name: {citySlug: city.slug, name: venueName}}})
        await tx.cinemaMovie.createMany({data: {cinemaId: cinema.id, movieId: movie.id}, skipDuplicates: true})
        await tx.screen.createMany({data: {cinemaId: cinema.id, name: screenName}, skipDuplicates: true})
        const screen = await tx.screen.findUniqueOrThrow({where: {cinemaId_name: {cinemaId: cinema.id, name: screenName}}})
        const where = {screenId_startsAt: {screenId: screen.id, startsAt: start}}
        const existing = await tx.show.findUnique({where, select: {id: true, movieId: true}})
        if (existing) {
          if (existing.movieId !== movie.id) throw new HttpError(409, 'That auditorium is in use at this time.')
          return {id: existing.id}
        }
        const layout = demoSeatLayout(10)
        await tx.seat.createMany({data: layout.map(seat => ({
          ...seat, screenId: screen.id,
        })), skipDuplicates: true})
        const seats = await tx.seat.findMany({where: {screenId: screen.id}})
        return tx.show.create({data: {
          movieId: movie.id, screenId: screen.id, startsAt: start, endsAt: new Date(+start + duration * 60_000),
          seats: {create: seats.map(seat => ({seatId: seat.id, enabled: seat.enabled, category: seat.category, price: demoSeatPrices[seat.category]}))},
        }, select: {id: true}})
      }, {isolationLevel: 'ReadCommitted'})
    } catch (error) {
      if (attempt >= 2 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error
    }
  }
}
