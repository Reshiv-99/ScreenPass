import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '../server/src/http'

const settings = z.object({
  email: z.string().trim().email().max(254).toLowerCase(),
  password: z.string().min(12).refine(value => Buffer.byteLength(value) <= 72),
})
const parsed = settings.safeParse({email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD})

async function setupOwner() {
  if (!parsed.success) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before setting up the owner.')
  const {email, password} = parsed.data
  const passwordHash = await bcrypt.hash(password, 12)
  await db.$transaction(async tx => {
    const owner = await tx.user.findFirst({where: {role: 'OWNER'}, select: {email: true}})
    if (owner) {
      if (owner.email === email) return
      throw new Error('This installation already has an owner.')
    }
    const existing = await tx.user.findUnique({where: {email}})
    if (existing) {
      if (existing.role !== 'ADMIN' || !await bcrypt.compare(password, existing.passwordHash)) {
        throw new Error('Use a new email or provide the current credentials for an existing administrator.')
      }
      await tx.user.update({where: {id: existing.id}, data: {role: 'OWNER'}})
    } else {
      await tx.user.create({data: {email, name: 'Cinema Owner', role: 'OWNER', passwordHash}})
    }
  }, {isolationLevel: 'Serializable'})
  console.log('Cinema owner is ready.')
}

setupOwner().catch(error => {
  console.error(error?.code ? 'Owner setup could not complete. Check the database and retry.' : error.message)
  process.exitCode = 1
}).finally(() => db.$disconnect())
