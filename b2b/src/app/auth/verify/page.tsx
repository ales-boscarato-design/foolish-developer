import { redirect } from 'next/navigation'

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (token) {
    redirect(`/api/auth/verify?token=${token}`)
  }
  redirect('/login?error=invalid')
}
