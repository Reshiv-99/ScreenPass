import { createHmac, timingSafeEqual } from 'node:crypto'
import { HttpError } from './http'

export function paymentMode() {
  const id = process.env.RAZORPAY_KEY_ID?.trim()
  const secret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!id && !secret) return 'demo'
  return id?.startsWith('rzp_test_') && secret ? 'razorpay-test' : 'unavailable'
}

export function razorpayConfig() {
  if (paymentMode() !== 'razorpay-test') throw new HttpError(503, 'Test checkout is not configured.')
  return {keyId: process.env.RAZORPAY_KEY_ID!.trim(), secret: process.env.RAZORPAY_KEY_SECRET!.trim()}
}

export function signatureMatches(payload: string | Buffer, received: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(received)) return false
  return timingSafeEqual(createHmac('sha256', secret).update(payload).digest(), Buffer.from(received, 'hex'))
}

export async function razorpayRequest(path: string, body?: object) {
  const {keyId, secret} = razorpayConfig()
  try {
    const response = await fetch('https://api.razorpay.com/v1' + path, {
      method: body ? 'POST' : 'GET',
      headers: {Authorization: 'Basic ' + Buffer.from(keyId + ':' + secret).toString('base64'), 'Content-Type': 'application/json'},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6500),
    })
    if (!response.ok) throw new Error('Provider rejected request')
    return await response.json() as unknown
  } catch {
    throw new HttpError(502, 'The payment service is temporarily unavailable. Please try again.')
  }
}
