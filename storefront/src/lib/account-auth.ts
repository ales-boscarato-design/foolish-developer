import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const getMagicSecret = () =>
  new TextEncoder().encode(process.env.MAGIC_LINK_SECRET!)

const getSessionSecret = () =>
  new TextEncoder().encode(process.env.SESSION_SECRET!)

export async function createMagicToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(getMagicSecret())
}

export async function verifyMagicToken(token: string): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getMagicSecret())
    if (typeof payload.email !== 'string') return null
    return { email: payload.email }
  } catch {
    return null
  }
}

export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(getSessionSecret())
}

export async function getSession(): Promise<{ email: string } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('foolish_session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSessionSecret())
    if (typeof payload.email !== 'string') return null
    return { email: payload.email }
  } catch {
    return null
  }
}

export const SESSION_COOKIE = {
  name: 'foolish_session',
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  },
}
