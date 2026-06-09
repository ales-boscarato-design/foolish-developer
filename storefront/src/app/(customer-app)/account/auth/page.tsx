import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/account-auth'

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (!token) redirect('/account/login?error=missing')

  const payload = await verifyMagicToken(token)
  if (!payload) redirect('/account/login?error=expired')

  const sessionToken = await createSessionToken(payload.email)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)

  redirect('/account')
}
