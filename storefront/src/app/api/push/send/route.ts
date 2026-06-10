import { NextRequest, NextResponse } from 'next/server'
import { sendPushToEmail, PushPayload } from '@/lib/push'

// Internal endpoint for Frank to send push notifications to customers.
// Protected by CRON_SECRET (same secret used for cron jobs).
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { email, title, message, url } = body as {
    email: string
    title: string
    message: string
    url?: string
  }

  if (!email || !title || !message) {
    return NextResponse.json({ error: 'Missing email, title, or message' }, { status: 400 })
  }

  const payload: PushPayload = { title, body: message, url }
  const sent = await sendPushToEmail(email, payload)

  return NextResponse.json({ sent })
}
