import { deliverBookingEmails } from '../server/src/booking-email'
import { demoShowtimes } from '../web/src/demo-showtimes'
import { releaseWindow } from '../server/src/releases'
import { createHmac, randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { app } from '../server/src/app'
import { db } from '../server/src/http'

const ids: string[] = []
const password = 'ScreenPass-tests-only!'

async function customer() {
  const agent = request.agent(app)
  const email = `test-${randomUUID()}@screenpass.test`
  const result = await agent.post('/api/auth/signup').send({email, password, name: 'Test customer'})
  expect(result.status).toBe(201)
  expect(result.headers['set-cookie'][0]).toContain('HttpOnly')
  ids.push(result.body.id)
  return {agent, email}
}

afterAll(async () => {
  await db.$transaction([
    db.showSeat.updateMany({where: {booking: {userId: {in: ids}}}, data: {bookingId: null}}),
    db.paymentAttempt.deleteMany({where: {userId: {in: ids}}}),
    db.booking.deleteMany({where: {userId: {in: ids}}}),
    db.user.deleteMany({where: {id: {in: ids}}}),
  ])
  await db.$disconnect()
})

describe('ScreenPass API', () => {
  test('serves a movie search, movie details, and all supported cities', async () => {
    const cities = await request(app).get('/api/cities').expect(200)
    expect(cities.body).toHaveLength(13)
    const result = await request(app).get('/api/movies/list/search').query({q: 'Dune'}).expect(200)
    expect(result.body.results.some((film: {id: number}) => film.id === 693134)).toBe(false)
    await request(app).get('/api/movies/693134').expect(404)
    await request(app).get('/api/movies/693134/videos').expect(404)
  })

  test('validates signup and checks password, sessions, origins and admin role', async () => {
    await request(app).post('/api/auth/signup').send({email: 'bad', password: 'x'}).expect(400)
    const {agent, email} = await customer()
    await agent.get('/api/admin/overview').expect(403)
    await agent.patch('/api/auth/me').set('Origin', 'https://unrelated.example').send({name: 'A new name'}).expect(403)
    await agent.post('/api/auth/logout').expect(204)
    await agent.get('/api/bookings').expect(401)
    await agent.post('/api/auth/login').send({email, password: 'Incorrect12345'}).expect(401)
    await agent.post('/api/auth/login').send({email, password}).expect(200)
    await agent.patch('/api/auth/me').send({name: 'Updated name'}).expect(200)
    const user = await db.user.findUniqueOrThrow({where: {email}})
    expect(user.passwordHash).toMatch(/^\$2/)
    expect(user.passwordHash).not.toContain(password)
  })

  test('allows exactly one concurrent allocation and restores seats on cancellation', async () => {
    const {agent: first} = await customer()
    const {agent: second} = await customer()
    const available = await request(app).get('/api/shows?city=delhi&movie=693134').expect(200)
    const showId = available.body[0].id as string
    const layout = await request(app).get(`/api/shows/${showId}/seats`).expect(200)
    const seat = layout.body.seats.find((seat: {enabled: boolean; booked: boolean; category: string}) => seat.enabled && !seat.booked && seat.category === 'PREMIUM')
    const attempts = [{agent: first, requestId: randomUUID()}, {agent: second, requestId: randomUUID()}]
    const previews = await Promise.all(attempts.map(({agent, requestId}) => agent.get('/api/bookings/requests/' + requestId).expect(200)))
    const snacks = [{id: 'popcorn', quantity: 2, price: 1}]
    await first.post('/api/bookings').send({showId, requestId: randomUUID(), seatIds: [seat.id], snacks: [{id: 'other', quantity: 1}]}).expect(400)
    const results = await Promise.all(attempts.map(({agent, requestId}) => agent.post('/api/bookings').send({showId, requestId, seatIds: [seat.id], snacks, total: 1})))
    expect(results.map(result => result.status).sort()).toEqual([201, 409])
    const index = results.findIndex(result => result.status === 201)
    const winner = attempts[index]
    const loser = attempts[1 - index]
    const record = results[index].body
    expect(record.total).toBe(seat.price + 398)
    expect(record.snacks).toEqual([{id: 'popcorn', name: 'Classic Popcorn (Large)', quantity: 2, price: 199}])
    expect(previews[index].body).toEqual({reference: record.reference, submitted: false})
    expect(record.ticketToken).toBeUndefined()
    await winner.agent.post('/api/bookings').send({showId, requestId: winner.requestId, seatIds: [seat.id], snacks}).expect(200)
    await winner.agent.post('/api/bookings').send({showId, requestId: winner.requestId, seatIds: [seat.id]}).expect(409)
    await winner.agent.get('/api/bookings/requests/' + winner.requestId).expect(200, {reference: record.reference, submitted: true})
    const privateReference = await loser.agent.get('/api/bookings/requests/' + winner.requestId).expect(200)
    expect(privateReference.body).toMatchObject({submitted: false})
    expect(privateReference.body.reference).not.toBe(record.reference)
    const booked = await request(app).get(`/api/shows/${showId}/seats`).expect(200)
    expect(booked.body.seats.find((item: {id: string}) => item.id === seat.id).booked).toBe(true)
    await loser.agent.post(`/api/bookings/${record.reference}/cancel`).expect(404)
    await loser.agent.get(`/api/bookings/${record.reference}/ticket`).expect(404)
    const ticket = await winner.agent.get(`/api/bookings/${record.reference}/ticket`).expect(200)
    expect(ticket.body.qr).toMatch(/^data:image\/png;base64,/)
    const {ticketToken} = await db.booking.findUniqueOrThrow({where: {reference: record.reference}})
    await request(app).get('/api/tickets/verify/' + ticketToken).expect(200, {status: 'VALID', reference: record.reference})
    await winner.agent.post(`/api/bookings/${record.reference}/cancel`).expect(200)
    await request(app).get('/api/tickets/verify/' + ticketToken).expect(200, {status: 'CANCELLED', reference: record.reference})
    expect(record.reference).toMatch(/^SP-[A-F0-9]{16}$/)
    const legacyReference = record.reference.replace(/^SP-/, 'CV-')
    await db.booking.update({where: {reference: record.reference}, data: {reference: legacyReference}})
    await winner.agent.get(`/api/bookings/${legacyReference}/ticket`).expect(200)
    await request(app).get('/api/tickets/verify/' + ticketToken).expect(200, {status: 'CANCELLED', reference: legacyReference})
    await request(app).get('/api/tickets/verify/' + 'f'.repeat(64)).expect(404)
    await loser.agent.post('/api/bookings').send({showId, seatIds: [seat.id], requestId: randomUUID()}).expect(201)
  })

  test('deduplicates reminders and exposes release status', async () => {
    const {agent} = await customer()
    await agent.post('/api/notifications/693134').expect(201)
    await agent.post('/api/notifications/693134').expect(201)
    const result = await agent.get('/api/notifications').expect(200)
    expect(result.body).toHaveLength(1)
    expect(result.body[0]).toMatchObject({tmdbId: 693134, released: true})
    await agent.delete('/api/notifications/693134').expect(204)
    await agent.get('/api/notifications').expect(200, [])
  })

  test('normalizes and caches OpenStreetMap cinema locations', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      elements: [
        {type: 'node', id: 14, lat: 26.9, lon: 75.8, tags: {name: 'Example cinema', 'addr:street': 'Example road'}},
        {type: 'way', id: 18, center: {lat: 26.8, lon: 75.7}, tags: {name: 'Second cinema'}},
        {type: 'node', id: 19, lat: 26.7, lon: 75.7},
      ],
    }), {status: 200}))
    try {
      const first = await request(app).get('/api/discovery/jaipur').expect(200)
      expect(first.body).toEqual([
        {id: 'node-14', name: 'Example cinema', address: 'Example road', lat: 26.9, lng: 75.8},
        {id: 'way-18', name: 'Second cinema', address: '', lat: 26.8, lng: 75.7},
      ])
      await request(app).get('/api/discovery/jaipur').expect(200, first.body)
      expect(upstream).toHaveBeenCalledTimes(1)
    } finally {upstream.mockRestore()}
  })

  test('creates one bookable demo seat map for a current movie and city', async () => {
    const movieId = 1_000_000_000 + Math.floor(Math.random() * 100_000_000)
    const release = releaseWindow().today
    vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
    const film = {id: movieId, title: 'Test release', release_date: release, poster_path: null, runtime: 110,
      release_dates: {results: [{iso_3166_1: 'IN', release_dates: [{type: 3, release_date: release + 'T00:00:00Z'}]}]}}
    const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(film))
    try {
      const startsAt = demoShowtimes()[0]
      const requests = ['custom-fatehabad', 'custom-1271934'].map(city => request(app).post('/api/shows/demo').send({movieId, city, startsAt}).expect(200))
      const [automatic, manual] = await Promise.all(requests)
      expect(automatic.body.id).toBe(manual.body.id)
      const layout = await request(app).get('/api/shows/' + automatic.body.id + '/seats').expect(200)
      expect(layout.body.screen.cinema.name).toBe('ScreenPass Demo Cinema · Fatehabad')
      expect(layout.body.seats).toHaveLength(80)
      for (const row of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
        const expected = row === 'H' ? {category: 'RECLINER', price: 750}
          : 'EFG'.includes(row) ? {category: 'PREMIUM', price: 550} : {category: 'STANDARD', price: 350}
        const seats = layout.body.seats.filter((seat: {row: string}) => seat.row === row)
        expect(seats).toHaveLength(10)
        for (const seat of seats) expect(seat).toMatchObject({...expected, enabled: true, booked: false})
      }
      expect(layout.body.seats.every((seat: {enabled: boolean}) => seat.enabled)).toBe(true)
      await request(app).post('/api/shows/demo').send({movieId, city: 'delhi', startsAt: '2008-01-01T00:00:00.000Z'}).expect(409)
    } finally {
      upstream.mockRestore()
      vi.unstubAllEnvs()
      await db.$transaction([
        db.show.deleteMany({where: {movieId}}),
        db.screen.deleteMany({where: {name: 'Demo Auditorium ' + movieId}}),
        db.cinemaMovie.deleteMany({where: {movieId}}),
        db.movie.deleteMany({where: {tmdbId: movieId}}),
      ])
    }
  })

  test('requests regional movies with the TMDB token on the server and backs off on rate limits', async () => {
    vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
    const upstream = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({results: [], page: 37, total_pages: 37}), {status: 200}))
      .mockResolvedValueOnce(new Response(null, {status: 429, headers: {'Retry-After': '30'}}))
    try {
      await request(app).get('/api/movies/list/now-playing?page=37').expect(200, {results: [], page: 37, total_pages: 37, source: 'tmdb'})
      const [url, options] = upstream.mock.calls[0]
      expect(new URL(String(url)).searchParams.get('region')).toBe('IN')
      expect(options?.headers).toMatchObject({Authorization: 'Bearer test-token'})
      const fallback = await request(app).get('/api/movies/list/upcoming?page=37').expect(200)
      expect(fallback.body.source).toBe('unavailable')
      await request(app).get('/api/movies/list/upcoming?page=38').expect(200)
      expect(upstream).toHaveBeenCalledTimes(2)
    } finally {upstream.mockRestore(); vi.unstubAllEnvs()}
  })

  test('allows only the owner to grant and revoke staff access on an existing session', async () => {
    const owner = request.agent(app)
    const login = await owner.post('/api/auth/login').send({email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD}).expect(200)
    expect(login.body.role).toBe('OWNER')
    const staff = await customer()
    const lookup = await owner.get('/api/admin/users').query({email: staff.email.toUpperCase()}).expect(200)
    expect(lookup.body).toHaveLength(1)
    const staffRole = '/api/admin/users/' + lookup.body[0].id + '/role'
    const ownerRole = '/api/admin/users/' + login.body.id + '/role'
    await staff.agent.patch(staffRole).send({role: 'ADMIN'}).expect(403)
    await owner.patch(staffRole).send({role: 'OWNER'}).expect(400)
    await owner.patch(ownerRole).send({role: 'CUSTOMER'}).expect(409)
    await owner.patch(staffRole).send({role: 'ADMIN'}).expect(204)
    await staff.agent.get('/api/admin/overview').expect(200)
    await staff.agent.patch(staffRole).send({role: 'CUSTOMER'}).expect(403)
    await owner.patch(staffRole).send({role: 'CUSTOMER'}).expect(204)
    await staff.agent.get('/api/admin/overview').expect(403)
    const account = await staff.agent.get('/api/auth/me').expect(200)
    expect(account.body.role).toBe('CUSTOMER')
  })

  test('holds seats, verifies sandbox captures, handles duplicate callbacks and rejects late captures', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', 'rzp_test_fixture')
    vi.stubEnv('RAZORPAY_KEY_SECRET', 'test-order-secret')
    vi.stubEnv('RAZORPAY_WEBHOOK_SECRET', 'test-webhook-secret')
    vi.stubEnv('RESEND_API_KEY', 'test-email-key')
    vi.stubEnv('BOOKING_EMAIL_FROM', 'ScreenPass <tickets@example.test>')
    let orderCount = 0
    const captures = new Map<string, {id: string; order_id: string; amount: number; currency: string; status: string}>()
    const provider = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.resend.com') return Response.json({id: 'paid-booking-email-fixture'})
      const path = url.pathname
      if (path === '/v1/orders') {
        const body = JSON.parse(String(init?.body))
        return Response.json({id: 'order_Fixture' + ++orderCount, amount: body.amount, currency: body.currency})
      }
      if (path.startsWith('/v1/payments/')) return Response.json(captures.get(path.split('/').at(-1)!))
      throw new Error('Unexpected provider request')
    })
    try {
      const first = await customer()
      const second = await customer()
      const showList = await request(app).get('/api/shows?city=delhi&movie=693134').expect(200)
      const showId = showList.body[0].id as string
      const layout = await request(app).get('/api/shows/' + showId + '/seats').expect(200)
      const [seat, other] = layout.body.seats.filter((seat: {enabled: boolean; booked: boolean}) => seat.enabled && !seat.booked)
      const checkout = {showId, seatIds: [seat.id], requestId: randomUUID(), amount: 1, snacks: [{id: 'nachos', quantity: 1}]}
      await first.agent.post('/api/bookings').send(checkout).expect(409)
      const order = await first.agent.post('/api/payments/orders').send(checkout).expect(200)
      expect(order.body).toMatchObject({status: 'ready', amount: (seat.price + 329) * 100, keyId: 'rzp_test_fixture'})
      expect(JSON.stringify(order.body)).not.toContain('test-order-secret')
      await second.agent.post('/api/payments/orders').send({...checkout, requestId: randomUUID()}).expect(409)
      const held = await request(app).get('/api/shows/' + showId + '/seats').expect(200)
      expect(held.body.seats.find((item: {id: string}) => item.id === seat.id)).toMatchObject({held: true, booked: false})
      const paymentId = 'pay_Fixture1'
      const orderId = order.body.orderId as string
      const capture = {id: paymentId, order_id: orderId, amount: order.body.amount, currency: 'INR', status: 'captured'}
      captures.set(paymentId, capture)
      const sign = (value: string, secret: string) => createHmac('sha256', secret).update(value).digest('hex')
      const signature = sign(orderId + '|' + paymentId, 'test-order-secret')
      await first.agent.post('/api/payments/verify').send({orderId, paymentId, signature: '0'.repeat(64)}).expect(400)
      await second.agent.post('/api/payments/verify').send({orderId, paymentId, signature}).expect(404)
      captures.set(paymentId, {...capture, status: 'authorized'})
      await first.agent.post('/api/payments/verify').send({orderId, paymentId, signature}).expect(202, {status: 'pending'})
      expect(await db.booking.findUnique({where: {userId_requestId: {userId: (await first.agent.get('/api/auth/me')).body.id, requestId: checkout.requestId}}})).toBeNull()
      captures.set(paymentId, capture)
      const verified = await first.agent.post('/api/payments/verify').send({orderId, paymentId, signature}).expect(200)
      expect(verified.body.status).toBe('confirmed')
      const email = await db.bookingEmail.findFirstOrThrow({where: {booking: {reference: verified.body.reference}}})
      expect(email).toMatchObject({recipient: first.email, status: 'PENDING'})
      await deliverBookingEmails()
      expect(await db.bookingEmail.findUnique({where: {bookingId: email.bookingId}})).toMatchObject({status: 'SENT'})
      const ticket = await first.agent.get('/api/bookings/' + verified.body.reference + '/ticket').expect(200)
      expect(ticket.body).toMatchObject({payment: {status: 'CONFIRMED', paymentId}, total: seat.price + 329, snacks: [{id: 'nachos', quantity: 1, price: 329}]})
      const webhook = JSON.stringify({event: 'payment.captured', payload: {payment: {entity: capture}}})
      await request(app).post('/api/payments/webhook').type('application/json').set('x-razorpay-signature', sign(webhook, 'test-webhook-secret')).send(webhook).expect(204)
      expect(await db.booking.count({where: {reference: verified.body.reference}})).toBe(1)
      const late = await first.agent.post('/api/payments/orders').send({showId, seatIds: [other.id], requestId: randomUUID()}).expect(200)
      const lateOrder = late.body.orderId as string
      await db.paymentAttempt.update({where: {orderId: lateOrder}, data: {expiresAt: new Date(0)}})
      await db.showSeat.update({where: {id: other.id}, data: {holdUntil: new Date(0)}})
      const latePayment = 'pay_Fixture2'
      captures.set(latePayment, {...capture, id: latePayment, order_id: lateOrder, amount: late.body.amount})
      const released = await request(app).get('/api/shows/' + showId + '/seats').expect(200)
      expect(released.body.seats.find((item: {id: string}) => item.id === other.id).held).toBe(false)
      await first.agent.post('/api/payments/verify').send({orderId: lateOrder, paymentId: latePayment, signature: sign(lateOrder + '|' + latePayment, 'test-order-secret')}).expect(200, {status: 'review'})
      expect(await db.paymentAttempt.findUnique({where: {orderId: lateOrder}})).toMatchObject({status: 'REVIEW', bookingId: null})
    } finally {
      provider.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  test('sends one confirmation email with a PDF ticket to the booking account', async () => {
    vi.stubEnv('RAZORPAY_KEY_ID', '')
    vi.stubEnv('RAZORPAY_KEY_SECRET', '')
    vi.stubEnv('RESEND_API_KEY', 'test-email-key')
    vi.stubEnv('BOOKING_EMAIL_FROM', 'ScreenPass <tickets@example.test>')
    const send = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {status: 503}))
      .mockResolvedValueOnce(Response.json({id: 'email-fixture'}))
    try {
      const buyer = await customer()
      const shows = await request(app).get('/api/shows?city=delhi&movie=693134').expect(200)
      const showId = shows.body[0].id
      const layout = await request(app).get('/api/shows/' + showId + '/seats').expect(200)
      const seat = layout.body.seats.find((item: {enabled: boolean; booked: boolean; held: boolean}) => item.enabled && !item.booked && !item.held)
      const input = {showId, seatIds: [seat.id], requestId: randomUUID(), email: 'wrong@example.test'}
      const booking = await buyer.agent.post('/api/bookings').send(input).expect(201)
      await buyer.agent.post('/api/bookings').send(input).expect(200)
      const job = await db.bookingEmail.findFirstOrThrow({where: {booking: {reference: booking.body.reference}}})
      expect(job.recipient).toBe(buyer.email)
      await deliverBookingEmails()
      await db.bookingEmail.update({where: {bookingId: job.bookingId}, data: {nextAttemptAt: new Date(0)}})
      await Promise.all([deliverBookingEmails(), deliverBookingEmails()])
      await deliverBookingEmails()
      expect(send).toHaveBeenCalledTimes(2)
      const [, sent] = send.mock.calls[1]
      expect(sent?.headers).toMatchObject({'Idempotency-Key': 'cinevault-ticket/' + job.bookingId})
      expect(sent?.body === send.mock.calls[0][1]?.body).toBe(true)
      const message = JSON.parse(String(sent?.body))
      expect(message.to).toEqual([buyer.email])
      expect(message.text).toContain(job.verificationUrl)
      expect(message.attachments[0].filename).toBe('ScreenPass-' + booking.body.reference + '.pdf')
      expect(Buffer.from(message.attachments[0].content, 'base64').subarray(0, 5).toString()).toBe('%PDF-')
      await buyer.agent.get('/api/bookings/' + booking.body.reference).expect(200).expect(response => {
        expect(response.body.email).toEqual({status: 'SENT'})
      })
    } finally {
      send.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  test('authenticates the configured admin and returns dashboard data', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD}).expect(200)
    const result = await agent.get('/api/admin/overview').expect(200)
    expect(result.body.cinemas).toBeGreaterThanOrEqual(13)
    expect(result.body.shows).toBeGreaterThan(0)
    const venue = await agent.post('/api/admin/cinemas').send({name: 'Test venue ' + randomUUID(), citySlug: 'delhi', address: 'QA venue', lat: 28.6, lng: 77.2}).expect(201)
    let screenId: string | undefined
    let showId: string | undefined
    try {
      await agent.patch('/api/admin/cinemas/' + venue.body.id).send({name: venue.body.name, citySlug: 'delhi', address: 'QA venue updated', lat: 28.6, lng: 77.2}).expect(200)
      await agent.post('/api/admin/movies').send({movieId: 693134, cinemaId: venue.body.id}).expect(201)
      await agent.get('/api/admin/users').expect(200)
      await agent.get('/api/admin/bookings').expect(200)
      const screen = await agent.post('/api/admin/screens').send({name: 'Test screen', cinemaId: venue.body.id, rows: 3, seatsPerRow: 6, premiumRows: 1}).expect(201)
      screenId = screen.body.id
      const seat = await db.seat.findFirstOrThrow({where: {screenId, row: 'A', number: 1}})
      await agent.patch('/api/admin/seats/' + seat.id).send({category: 'PREMIUM', enabled: false}).expect(200)
      const input = {screenId, movieId: 693134, startsAt: new Date(Date.now() + 86400_000).toISOString(), endsAt: new Date(Date.now() + 93600_000).toISOString(), standardPrice: 200, premiumPrice: 300}
      const show = await agent.post('/api/admin/shows').send(input).expect(201)
      showId = show.body.id
      await agent.post('/api/admin/shows').send(input).expect(409)
      await agent.patch('/api/admin/shows/' + showId).send({...input, premiumPrice: 450}).expect(200)
      const layout = await request(app).get('/api/shows/' + showId + '/seats').expect(200)
      expect(layout.body.seats[0]).toMatchObject({row: 'A', number: 1, enabled: false, category: 'PREMIUM', price: 450})
      const {agent: visitor} = await customer()
      await visitor.post('/api/bookings').send({showId, seatIds: [layout.body.seats[0].id], requestId: randomUUID()}).expect(409)
    } finally {
      if (showId) await agent.delete('/api/admin/shows/' + showId).expect(204)
      if (screenId) await agent.delete('/api/admin/screens/' + screenId).expect(204)
      await agent.delete('/api/admin/cinemas/' + venue.body.id).expect(204)
    }
  })
})
