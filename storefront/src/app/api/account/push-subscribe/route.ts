import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { savePushSubscription, markPushSequenceStep } from '@/lib/account-db'
import { sendPushToEmail } from '@/lib/push'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subscription = await req.json()
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  const { isFirstTime } = await savePushSubscription(session.email, subscription)

  if (isFirstTime) {
    // Fetch on_subscribe sequence delay=0 steps from CMS and send immediately
    const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
    const cmsSecret = process.env.PAYLOAD_API_SECRET
    if (cmsUrl && cmsSecret) {
      try {
        const res = await fetch(
          `${cmsUrl}/api/push-sequences?where[trigger][equals]=on_subscribe&where[active][equals]=true&depth=1&limit=1`,
          { headers: { 'x-storefront-secret': cmsSecret }, next: { revalidate: 0 } }
        )
        const data = await res.json() as { docs?: Array<{ steps?: Array<{ step_key: string; delay_hours: number; title: string; body: string; url?: string; active: boolean }> }> }
        const sequence = data.docs?.[0]
        if (sequence?.steps) {
          for (const step of sequence.steps) {
            if (!step.active || step.delay_hours !== 0) continue
            await sendPushToEmail(session.email, { title: step.title, body: step.body, url: step.url })
            await markPushSequenceStep(session.email, step.step_key)
          }
        }
      } catch (e) {
        console.error('push welcome step failed:', e)
      }
    }

    // Notify Frank via nanobot webhook
    const nanobotUrl = process.env.NANOBOT_WEBHOOK_URL
    if (nanobotUrl) {
      fetch(`${nanobotUrl}/hooks/foolish-push-subscribed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: session.email }),
      }).catch((e) => console.error('nanobot push notify failed:', e))
    }
  }

  return NextResponse.json({ ok: true })
}
