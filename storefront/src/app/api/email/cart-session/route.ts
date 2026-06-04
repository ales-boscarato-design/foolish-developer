import { NextRequest, NextResponse } from 'next/server'
import { saveCartSession } from '@/lib/marketing-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { email, cartData } = await req.json()

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    if (!Array.isArray(cartData) || cartData.length === 0) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    await saveCartSession(email.toLowerCase().trim(), cartData)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('cart-session error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
