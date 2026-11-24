import { Router, type RequestHandler, type Response } from 'express'
import type { Role } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { rateLimit } from 'express-rate-limit'
import { z } from 'zod'
import { appOrigin, db, digest, HttpError, randomToken } from './http'

export const publicUser = {id: true, name: true, email: true, role: true} as const
declare global {
  namespace Express {
    interface Request { user?: {id: string; name: string; email: string; role: Role} }
  }
}

const cookie = 'cinevault_session'
const duration = 7 * 24 * 60 * 60 * 1000
const cookieOptions = () => ({httpOnly: true, secure: appOrigin().startsWith('https:'), sameSite: 'lax' as const, path: '/'})
const password = z.string().min(8, 'Use at least eight characters.').refine(value => Buffer.byteLength(value) <= 72, 'Password is too long.')
const credentials = z.object({email: z.string().trim().email().max(254).toLowerCase(), password})
const name = z.string().trim().min(2).max(80)
const dummyHash = bcrypt.hashSync(randomToken(), 12)
const limited = rateLimit({windowMs: 15 * 60 * 1000, limit: 35, standardHeaders: 'draft-8', legacyHeaders: false, message: {error: 'Too many attempts. Try again in a few minutes.'}})

function sessionData(token: string) {
  return {tokenHash: digest(token), expiresAt: new Date(Date.now() + duration)}
}

function setSessionCookie(response: Response, token: string) {
  response.cookie(cookie, token, {...cookieOptions(), maxAge: duration})
}

export const readUser: RequestHandler = async (request, _response, next) => {
  const token = request.cookies[cookie]
  if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
    const session = await db.session.findUnique({where: {tokenHash: digest(token)}, select: {expiresAt: true, user: {select: publicUser}}})
    if (session && session.expiresAt > new Date()) request.user = session.user
  }
  next()
}

export const signedIn: RequestHandler = (request, _response, next) => {
  if (!request.user) throw new HttpError(401, 'Sign in to continue.')
  next()
}
export const adminOnly: RequestHandler = (request, _response, next) => {
  if (request.user?.role !== 'ADMIN' && request.user?.role !== 'OWNER') throw new HttpError(403, 'Admin access is required.')
  next()
}

export const auth = Router()
auth.get('/me', (request, response) => { response.json(request.user ?? null) })
auth.post('/signup', limited, async (request, response) => {
  const input = credentials.extend({name}).parse(request.body)
  const token = randomToken()
  const user = await db.user.create({data: {
    email: input.email, name: input.name, passwordHash: await bcrypt.hash(input.password, 12),
    sessions: {create: sessionData(token)},
  }, select: publicUser})
  setSessionCookie(response, token)
  response.status(201).json(user)
})
auth.post('/login', limited, async (request, response) => {
  const input = credentials.parse(request.body)
  const user = await db.user.findUnique({where: {email: input.email}})
  const matches = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash)
  if (!user || !matches) throw new HttpError(401, 'Email or password is incorrect.')
  const token = randomToken()
  await db.session.create({data: {...sessionData(token), userId: user.id}})
  setSessionCookie(response, token)
  response.json({id: user.id, name: user.name, email: user.email, role: user.role})
})
auth.post('/logout', async (request, response) => {
  const token = request.cookies[cookie]
  if (typeof token === 'string') await db.session.deleteMany({where: {tokenHash: digest(token)}})
  response.clearCookie(cookie, cookieOptions()).sendStatus(204)
})
auth.patch('/me', signedIn, async (request, response) => {
  response.json(await db.user.update({where: {id: request.user!.id}, data: {name: name.parse(request.body?.name)}, select: publicUser}))
})
