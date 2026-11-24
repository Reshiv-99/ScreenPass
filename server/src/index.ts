import { app } from './app'
import { db } from './http'
import { startBookingEmailWorker } from './booking-email'

const port = Number(process.env.PORT || 4000)
const server = app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`ScreenPass API listening on port ${port}`))
const stopEmail = startBookingEmailWorker()
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => { void stopEmail().finally(() => db.$disconnect()) }))
}
