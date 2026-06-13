import { NextRequest, NextResponse } from 'next/server'
import { notifyNanobot } from '@/lib/nanobot'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

function parseVat(raw: string): { countryCode: string; vatNumber: string } | null {
  const trimmed = raw.trim().toUpperCase().replace(/\s/g, '')
  const itMatch = trimmed.match(/^(?:IT)?(\d{11})$/)
  if (itMatch) return { countryCode: 'IT', vatNumber: itMatch[1] }
  const euMatch = trimmed.match(/^([A-Z]{2})([A-Z0-9]{2,13})$/)
  if (euMatch) return { countryCode: euMatch[1], vatNumber: euMatch[2] }
  return null
}

async function checkVies(countryCode: string, vatNumber: string): Promise<boolean> {
  try {
    const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${countryCode}/vat/${vatNumber}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return false
    const data = await res.json()
    return data?.isValid === true
  } catch {
    return false
  }
}

function generateCode(vatNumber: string): string {
  const digits = vatNumber.replace(/\D/g, '')
  const suffix = digits.slice(-8).padStart(8, '0')
  return `FPRO-${suffix}`
}

export async function POST(req: NextRequest) {
  let body: {
    vatNumber?: string
    businessName?: string
    contactName?: string
    email?: string
    telegramUsername?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const { vatNumber, businessName, contactName, email, telegramUsername } = body

  if (!vatNumber || !businessName || !contactName || !email) {
    return NextResponse.json({ success: false, error: 'missing_fields' }, { status: 400 })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ success: false, error: 'invalid_email' }, { status: 400 })
  }

  const parsed = parseVat(vatNumber)
  if (!parsed) {
    return NextResponse.json({ success: false, error: 'invalid_vat_format' }, { status: 400 })
  }

  const viesValid = await checkVies(parsed.countryCode, parsed.vatNumber)
  if (!viesValid) {
    return NextResponse.json({ success: false, error: 'vat_not_found' }, { status: 422 })
  }

  const code = generateCode(parsed.vatNumber)
  const normalizedVat = `${parsed.countryCode}${parsed.vatNumber}`

  // Create ProMember
  const memberRes = await fetch(`${CMS_URL}/api/pro-members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vatNumber: normalizedVat,
      businessName,
      contactName,
      email,
      telegramId: telegramUsername ?? null,
      discountCode: code,
      status: 'active',
      channelInvited: false,
      totalSpent: 0,
      orderCount: 0,
      joinedAt: new Date().toISOString(),
    }),
  })

  if (!memberRes.ok) {
    const errText = await memberRes.text()
    if (memberRes.status === 400 && errText.includes('unique')) {
      return NextResponse.json({ success: false, error: 'already_registered' }, { status: 409 })
    }
    console.error('[pro/register] CMS pro-member create failed:', errText)
    return NextResponse.json({ success: false, error: 'cms_error' }, { status: 502 })
  }

  const memberData = await memberRes.json()
  const memberId = memberData.doc?.id

  // Create PromoCode
  const promoRes = await fetch(`${CMS_URL}/api/promo-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      type: 'percent_pro',
      active: true,
      proMember: memberId,
      usageCount: 0,
    }),
  })

  if (!promoRes.ok) {
    console.error('[pro/register] CMS promo-code create failed:', await promoRes.text())
  }

  // Notify Frank
  notifyNanobot('/hooks/foolish-pro-register', {
    vatNumber: normalizedVat,
    businessName,
    contactName,
    email,
    telegramUsername: telegramUsername ?? null,
    discountCode: code,
  })

  return NextResponse.json({ success: true, code })
}
