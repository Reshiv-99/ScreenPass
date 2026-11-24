import { Prisma, PrismaClient } from '@prisma/client'
import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { createHash, randomBytes } from 'node:crypto'

export const db = new PrismaClient()
export const randomToken = () => randomBytes(32).toString('hex')
export const digest = (token: string) => createHash('sha256').update(token).digest('hex')
export const appOrigin = () => new URL(process.env.APP_ORIGIN || 'http://localhost:5173').origin

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof HttpError) {
    response.status(error.status).json({error: error.message})
  } else if (error instanceof ZodError) {
    response.status(400).json({error: error.issues.map(issue => issue.message).join(' ')})
  } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const messages: Record<string, [number, string]> = {
      P2002: [409, 'This record already exists or the requested seats were just taken.'],
      P2003: [409, 'Related inventory or bookings prevent this change.'],
      P2025: [404, 'Record not found.'],
      P2034: [409, 'Inventory changed during this request. Please try again.'],
    }
    console.error('PRISMA ERROR:', error.code, error.message, error.meta) 
    const [status, message] = messages[error.code] ?? [500, 'The database request failed.']
    response.status(status).json({error: `${message} [${error.code}] ${error.message.slice(-300)}`})
   // response.status(status).json({error: message})
  } else if (error instanceof Prisma.PrismaClientInitializationError) {
    response.status(503).json({error: 'MySQL is unavailable. Check the local database configuration.'})
  } else {
    const malformed = error instanceof SyntaxError && 'status' in error && error.status === 400
    if (!malformed) console.error('Unexpected API error:', error instanceof Error ? error.name : 'Unknown error')
    response.status(malformed ? 400 : 500).json({error: malformed ? 'Invalid JSON.' : 'Something went wrong. Try again.'})
  }
}
