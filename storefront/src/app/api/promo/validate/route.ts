import { NextRequest, NextResponse } from 'next/server'
import { getOfferByCode } from '@/lib/account-db'
import { resolveCheckoutCatalog } from '@/lib/catalog'
import {
  calculateCheckoutPromo,
  cartSubtotalCents,
  normalizePromoCode,
  parseEnvPromoType,
  parsePromoCodes,
  type PromoRecord,
} from '@/lib/promo'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'

function getCodes(): Record<string, string> {
  return parsePromoCodes(process.env.PROMO_CODES)
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ valid: false })
  }

  if (!body || typeof body !== 'object') return NextResponse.json({ valid: false })
  const { code, items } = body as { code?: unknown; items?: unknown }

  const normalizedCode = normalizePromoCode(code)
  if (!normalizedCode) {
    return NextResponse.json({ valid: false })
  }

  const catalogResult = await resolveCheckoutCatalog(items)
  if (catalogResult.status === 'unavailable') {
    return NextResponse.json({ valid: false, error: 'Catalogo temporaneamente non disponibile' }, { status: 503 })
  }
  if (catalogResult.status !== 'ok') {
    return NextResponse.json({ valid: false }, { status: 400 })
  }

  // 1. Check CMS PromoCodes
  try {
    const cmsRes = await fetch(
      `${CMS_URL}/api/promo-codes?where[code][equals]=${encodeURIComponent(normalizedCode)}&depth=0&limit=1`,
      {
        headers: process.env.PAYLOAD_API_SECRET
          ? { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET }
          : undefined,
        cache: 'no-store',
      },
    )
    if (cmsRes.ok) {
      const cmsData = await cmsRes.json()
      const cmsCode = cmsData.docs?.[0] as PromoRecord | undefined
      if (cmsCode) {
        const promoResult = calculateCheckoutPromo({
          promoCode: normalizedCode,
          items: catalogResult.items,
          record: cmsCode,
        })
        if (promoResult.status !== 'valid') return NextResponse.json({ valid: false })
        const promo = promoResult.promo
        return NextResponse.json({
          valid: true,
          type: promo.type,
          ...(promo.discountPercent !== undefined ? { discountPercent: promo.discountPercent } : {}),
          ...(promo.discountAmountCents > 0 ? { discountAmount: Number((promo.discountAmountCents / 100).toFixed(2)) } : {}),
        })
      }
    }
  } catch {
    // CMS unreachable — fall through to env var
  }

  // 2. Offerte personali post-ordine (comportamento live: da preservare).
  // Il consumo avviene sull'ordine pagato, non qui: questa rotta valida soltanto.
  try {
    const offer = await getOfferByCode(normalizedCode)
    if (offer) {
      const subtotalCents = cartSubtotalCents(catalogResult.items)
      if (subtotalCents === null || subtotalCents <= 0) return NextResponse.json({ valid: false })
      const discountPercent = offer.discount_percent
      const discountAmountCents = Math.round((subtotalCents * discountPercent) / 100)
      return NextResponse.json({
        valid: true,
        type: 'percent_offer',
        discountPercent,
        discountAmount: Number((discountAmountCents / 100).toFixed(2)),
      })
    }
  } catch {
    // DB unreachable — fall through to env var
  }

  // 3. Fallback: env var PROMO_CODES
  const codes = getCodes()
  const type = parseEnvPromoType(codes[normalizedCode])
  if (!type) return NextResponse.json({ valid: false })
  const promoResult = calculateCheckoutPromo({
    promoCode: normalizedCode,
    items: catalogResult.items,
    record: { code: normalizedCode, type, active: true },
  })
  if (promoResult.status !== 'valid') return NextResponse.json({ valid: false })
  const promo = promoResult.promo
  return NextResponse.json({
    valid: true,
    type: promo.type,
    ...(promo.discountPercent !== undefined ? { discountPercent: promo.discountPercent } : {}),
    ...(promo.discountAmountCents > 0 ? { discountAmount: Number((promo.discountAmountCents / 100).toFixed(2)) } : {}),
  })
}
