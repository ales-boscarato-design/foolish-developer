import { NextRequest, NextResponse } from 'next/server'
import { getOfferByCode } from '@/lib/account-db'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

function getCodes(): Record<string, string> {
  try {
    return JSON.parse(process.env.PROMO_CODES || '{}')
  } catch {
    return {}
  }
}

function calcProDiscount(total: number): { discountPercent: number; discountAmount: number } {
  const discountPercent = total >= 400 ? 20 : 15
  const discountAmount = parseFloat(((total * discountPercent) / 100).toFixed(2))
  return { discountPercent, discountAmount }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { code, total } = body as { code?: string; total?: number }

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ valid: false })
  }

  const normalizedCode = code.toUpperCase().trim()

  // 1. Check CMS PromoCodes
  try {
    const cmsRes = await fetch(
      `${CMS_URL}/api/promo-codes?where[code][equals]=${encodeURIComponent(normalizedCode)}&where[active][equals]=true&depth=0&limit=1`,
      { cache: 'no-store' },
    )
    if (cmsRes.ok) {
      const cmsData = await cmsRes.json()
      const cmsCode = cmsData.docs?.[0]
      if (cmsCode) {
        if (cmsCode.type === 'percent_pro') {
          const cartTotal = typeof total === 'number' && total > 0 ? total : 0
          const { discountPercent, discountAmount } = calcProDiscount(cartTotal)
          return NextResponse.json({ valid: true, type: 'percent_pro', discountPercent, discountAmount })
        }
        return NextResponse.json({ valid: true, type: cmsCode.type })
      }
    }
  } catch {
    // CMS unreachable — fall through to env var
  }

  // 2. Check customer offers (post-order personal offers)
  try {
    const offer = await getOfferByCode(normalizedCode)
    if (offer) {
      const cartTotal = typeof total === 'number' && total > 0 ? total : 0
      const discountAmount = parseFloat(((cartTotal * offer.discount_percent) / 100).toFixed(2))
      return NextResponse.json({ valid: true, type: 'percent_offer', discountPercent: offer.discount_percent, discountAmount })
    }
  } catch {
    // DB unreachable — fall through
  }

  // 3. Fallback: env var PROMO_CODES
  const codes = getCodes()
  const type = codes[normalizedCode]
  if (!type) return NextResponse.json({ valid: false })
  return NextResponse.json({ valid: true, type })
}
