import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { bounceByEmail } from '@/lib/marketing-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()

  const wh = new Webhook(secret)
  try {
    wh.verify(rawBody, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    })
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody) as { type: string; data: { email?: string; to?: string[] } }

  if (event.type === 'email.bounced' || event.type === 'email.complained') {
    const email = event.data.email ?? event.data.to?.[0]
    if (email) {
      await bounceByEmail(email).catch((e) => console.error('bounce update failed:', e))
    }
  }

  return NextResponse.json({ received: true })
}
