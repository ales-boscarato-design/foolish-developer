import { NextRequest, NextResponse } from 'next/server'
import { getOrdersForReview, markReviewEmailSent, logEmail } from '@/lib/marketing-db'
import { sendReviewRequestEmail, notifyFrank } from '@/lib/resend'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orders = await getOrdersForReview()
  const recipients: string[] = []
  const errors: string[] = []

  for (const order of orders) {
    try {
      const email = order.customer_email

      const subRows = await sql<{ id: string; locale: string }[]>`
        SELECT id, locale FROM marketing.subscribers WHERE email = ${email} LIMIT 1
      `
      const subscriberId = subRows[0]?.id ?? null
      const locale = subRows[0]?.locale ?? 'it'

      if (!subscriberId) continue

      const resendId = await sendReviewRequestEmail({
        to: email,
        name: order.customer_name,
        locale,
        subscriberId,
        reviewUrl: '', // TODO: populated in Task 4 (review token generation)
      })

      await markReviewEmailSent(order.id)
      await logEmail({ email, type: 'review_request', resendId, subscriberId })
      recipients.push(email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`order ${order.id}: ${msg}`)
      console.error('review-request cron error:', err)
    }
  }

  await notifyFrank({ cron: 'review_request', sent: recipients.length, recipients, errors })
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
