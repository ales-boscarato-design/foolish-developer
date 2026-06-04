import { notFound } from 'next/navigation'
import { jwtVerify } from 'jose'
import { getLocale } from 'next-intl/server'
import { reviewExistsForOrder } from '@/lib/reviews-db'
import { ReviewForm } from '@/components/ReviewForm'

export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ token?: string }>
}

export default async function RecensisciPage({ searchParams }: Props) {
  const { token } = await searchParams
  const locale = await getLocale()

  if (!token) notFound()

  type ReviewPayload = { orderId: number; productId: number; productSlug: string; subscriberId: string }
  let payload: ReviewPayload | null = null
  try {
    const secret = new TextEncoder().encode(process.env.REVIEW_SECRET!)
    const result = await jwtVerify(token, secret)
    payload = result.payload as unknown as ReviewPayload
  } catch {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <p className="text-lg" style={{ color: 'var(--muted-fg)' }}>
          {locale === 'it' ? 'Link non valido o scaduto.' : 'Invalid or expired link.'}
        </p>
      </main>
    )
  }

  if (!payload) notFound()

  const already = await reviewExistsForOrder(payload.orderId)
  if (already) {
    return (
      <main className="max-w-lg mx-auto px-4 py-16 text-center">
        <p className="text-2xl mb-4">✦</p>
        <p style={{ color: 'var(--muted-fg)' }}>
          {locale === 'it' ? 'Hai già lasciato una recensione per questo ordine.' : 'You already reviewed this order.'}
        </p>
      </main>
    )
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-2 text-center" style={{ color: 'var(--foreground)' }}>
        {locale === 'it' ? 'La tua recensione' : 'Your review'}
      </h1>
      <ReviewForm token={token as string} locale={locale} />
    </main>
  )
}
