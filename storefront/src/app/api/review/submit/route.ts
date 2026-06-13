import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { insertReview, reviewExistsForOrder } from '@/lib/reviews-db'
import sql from '@/lib/db'
import { notifyNanobot } from '@/lib/nanobot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SITE = 'https://thefoolishbutcher.com'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json() as {
    token: string
    rating: number
    reviewText?: string
    photoUrls?: string[]
    reviewerName?: string
  }

  const secret = new TextEncoder().encode(process.env.REVIEW_SECRET!)
  let payload: { orderId: number; productId: number; productSlug: string; subscriberId: string }
  try {
    const result = await jwtVerify(body.token, secret)
    payload = result.payload as typeof payload
  } catch {
    return NextResponse.json({ error: 'Token non valido o scaduto' }, { status: 400 })
  }

  const exists = await reviewExistsForOrder(payload.orderId)
  if (exists) {
    return NextResponse.json({ error: 'Hai già lasciato una recensione per questo ordine' }, { status: 409 })
  }

  if (!body.rating || body.rating < 1 || body.rating > 5) {
    return NextResponse.json({ error: 'Rating non valido' }, { status: 400 })
  }

  const review = await insertReview({
    orderId: payload.orderId,
    productId: payload.productId,
    productSlug: payload.productSlug,
    subscriberId: payload.subscriberId,
    rating: body.rating,
    body: body.reviewText?.trim() || null,
    photoUrls: body.photoUrls ?? [],
    reviewerName: body.reviewerName?.trim() || null,
  })

  const productRows = await sql<{ name: string }[]>`
    SELECT name FROM products WHERE id = ${payload.productId} LIMIT 1
  `
  const productName = productRows[0]?.name ?? payload.productSlug

  const adminSecret = process.env.REVIEW_ADMIN_SECRET!
  const moderateBase = `${SITE}/api/review/moderate`
  notifyNanobot('/hooks/foolish-storefront-review', {
    reviewId: review.id,
    productName,
    productSlug: payload.productSlug,
    rating: body.rating,
    body: body.reviewText?.trim() || null,
    reviewerName: body.reviewerName?.trim() || 'Anonimo',
    photoUrls: body.photoUrls ?? [],
    publishUrl: `${moderateBase}?id=${review.id}&action=publish&token=${adminSecret}`,
    removeUrl: `${moderateBase}?id=${review.id}&action=remove&token=${adminSecret}`,
  })

  return NextResponse.json({ ok: true })
}
