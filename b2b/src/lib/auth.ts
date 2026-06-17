import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const MAGIC_SECRET = new TextEncoder().encode(process.env.B2B_MAGIC_SECRET!)
const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)

export interface B2BSession {
  proMemberId: number
  email: string
  businessName: string
  contactName: string
  vatNumber: string
  status: 'active' | 'suspended'
}

export async function createMagicToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(MAGIC_SECRET)
}

export async function verifyMagicToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, MAGIC_SECRET)
    return payload.email as string
  } catch {
    return null
  }
}

export async function createSessionToken(session: B2BSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(SESSION_SECRET)
}

export async function verifySessionToken(token: string): Promise<B2BSession | null> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET)
    return payload as unknown as B2BSession
  } catch {
    return null
  }
}

export async function getServerSession(): Promise<B2BSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return null
  return verifySessionToken(token)
}

export const SESSION_COOKIE = {
  name: 'b2b_session',
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  },
}
