import { NextRequest, NextResponse } from 'next/server'
import { getSubscribersForSequence, markPushSequenceStep } from '@/lib/account-db'
import { sendPushToEmail } from '@/lib/push'

// Runs every hour via Railway cron.
// Fetches active on_subscribe sequences from CMS, then sends pending steps
// to subscribers based on time elapsed since push_subscribed_at.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const cmsSecret = process.env.PAYLOAD_API_SECRET
  if (!cmsUrl || !cmsSecret) {
    return NextResponse.json({ error: 'CMS not configured' }, { status: 500 })
  }

  // Fetch all active sequences (currently only on_subscribe is automated)
  const res = await fetch(
    `${cmsUrl}/api/push-sequences?where[trigger][equals]=on_subscribe&where[active][equals]=true&depth=1&limit=10`,
    { headers: { 'x-storefront-secret': cmsSecret }, next: { revalidate: 0 } }
  )
  const data = await res.json() as {
    docs?: Array<{
      steps?: Array<{ step_key: string; delay_hours: number; title: string; body: string; url?: string; active: boolean }>
    }>
  }

  const sequences = data.docs ?? []
  if (!sequences.length) return NextResponse.json({ sent: 0, skipped: 0 })

  const subscribers = await getSubscribersForSequence()
  const now = Date.now()
  let sent = 0
  let skipped = 0

  for (const subscriber of subscribers) {
    const subscribedMs = new Date(subscriber.push_subscribed_at).getTime()
    const hoursElapsed = (now - subscribedMs) / (1000 * 60 * 60)
    const state = subscriber.push_sequence_state ?? {}

    for (const sequence of sequences) {
      for (const step of sequence.steps ?? []) {
        if (!step.active) continue
        if (step.delay_hours === 0) continue // already sent inline at subscribe time
        if (state[step.step_key]) continue   // already sent
        if (hoursElapsed < step.delay_hours) continue

        const ok = await sendPushToEmail(subscriber.email, {
          title: step.title,
          body: step.body,
          url: step.url,
        })
        await markPushSequenceStep(subscriber.email, step.step_key)
        if (ok) sent++; else skipped++
      }
    }
  }

  console.log(`[push-sequences cron] sent=${sent} skipped=${skipped}`)
  return NextResponse.json({ sent, skipped })
}
