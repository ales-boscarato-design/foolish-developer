import { adminSecret } from '@/lib/admin-secret'
import { NextRequest, NextResponse } from 'next/server'
import { createCustomerOffer } from '@/lib/account-db'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/create-offer
 * Protected by FOOLISH_ADMIN_SECRET (fallback STOREFRONT_API_SECRET, poi
 * PAYLOAD_API_SECRET durante la transizione).
 *
 * Body: { email, productSlug, discountPercent?, validityHours? }
 *
 * Creates (or replaces) a customer offer manually — useful for testing
 * and for customers who ordered before the feature was deployed.
 */
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret')
  const expected = adminSecret()
  if (!secret || !expected || secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { email, productSlug, discountPercent = 15, validityHours = 24 } = body as {
    email?: string
    productSlug?: string
    discountPercent?: number
    validityHours?: number
  }

  if (!email || !productSlug) {
    return NextResponse.json({ error: 'email and productSlug are required' }, { status: 400 })
  }

  const code = await createCustomerOffer(
    email.toLowerCase().trim(),
    'MANUAL',
    productSlug,
    discountPercent,
    validityHours,
  )

  return NextResponse.json({ ok: true, code, email, productSlug, discountPercent, validityHours })
}
