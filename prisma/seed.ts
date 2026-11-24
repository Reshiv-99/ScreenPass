import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { cities, samples } from '../server/src/catalogue'
import { db } from '../server/src/http'
import { demoSeatLayout, demoSeatPrices } from '../server/src/seat-layout'
import { z } from 'zod'

async function seed() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD
  if (email || password) {
    const admin = z.object({email: z.string().email(), password: z.string().min(12).refine(value => Buffer.byteLength(value) <= 72)}).parse({email, password})
    const existing = await db.user.findUnique({where: {email: admin.email}})
    if (existing && existing.role === 'CUSTOMER') throw new Error('Choose a different admin email. The existing account is a customer.')
    if (!existing) await db.user.create({data: {email: admin.email, name: 'ScreenPass Admin', role: 'ADMIN', passwordHash: await bcrypt.hash(admin.password, 12)}})
  }
  for (const film of samples) {
    await db.movie.upsert({where: {tmdbId: film.id}, update: {}, create: {tmdbId: film.id, title: film.title, poster: film.poster_path}})
  }
  for (const city of cities) {
    await db.city.upsert({where: {slug: city.slug}, update: {}, create: city})
    const name = 'ScreenPass ' + city.name
    const cinema = await db.cinema.upsert({
      where: {citySlug_name: {citySlug: city.slug, name}}, update: {},
      create: {name, citySlug: city.slug, address: city.name + ' City Centre · Demo venue', lat: city.lat, lng: city.lng},
    })
    const screenName = 'Screen 1'
    const screen = await db.screen.upsert({
      where: {cinemaId_name: {cinemaId: cinema.id, name: screenName}}, update: {},
      create: {name: screenName, cinemaId: cinema.id, seats: {create: demoSeatLayout(12)}},
      include: {seats: true},
    })
    for (const [index, film] of samples.entries()) {
      await db.cinemaMovie.upsert({where: {cinemaId_movieId: {cinemaId: cinema.id, movieId: film.id}}, update: {}, create: {cinemaId: cinema.id, movieId: film.id}})
      for (let day = 1; day <= 3; day++) {
        const dayOffset = Math.floor(index / 3) * 3 + day
        const indiaNow = new Date(Date.now() + 330 * 60_000)
        const startsAt = new Date(Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate() + dayOffset, 6 + (index % 3) * 4))
        const endsAt = new Date(startsAt.getTime() + ((film.runtime ?? 150) + 15) * 60_000)
        const overlap = await db.show.findFirst({where: {screenId: screen.id, startsAt: {lt: endsAt}, endsAt: {gt: startsAt}}})
        if (overlap) continue
        await db.show.create({data: {
          screenId: screen.id, movieId: film.id, startsAt, endsAt,
          seats: {create: screen.seats.map(seat => ({seatId: seat.id, category: seat.category, enabled: seat.enabled, price: demoSeatPrices[seat.category]}))},
        }})
      }
    }
  }
  console.log('Seeded 13 demo cities and cinema inventory.')
}
seed().catch(error => { console.error('Seed failed:', error.name); process.exitCode = 1 }).finally(() => db.$disconnect())
