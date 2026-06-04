import { NextRequest, NextResponse } from 'next/server'
import {
  getAbandonedCarts,
  markCartEmailSent,
  isSubscriberBlocked,
  logEmail,
} from '@/lib/marketing-db'
import { sendAbandonedCartEmail, notifyFrank } from '@/lib/resend'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const carts = await getAbandonedCarts()
  const recipients: string[] = []
  const errors: string[] = []

  for (const cart of carts) {
    try {
      const email = cart.email!
      const blocked = await isSubscriberBlocked(email)
      if (blocked) continue

      const subRows = await sql<{ id: string; locale: string }[]>`
        SELECT id, locale FROM marketing.subscribers WHERE email = ${email} LIMIT 1
      `
      if (subRows.length === 0) continue

      const subscriberId = subRows[0].id
      const locale = subRows[0].locale

      const resendId = await sendAbandonedCartEmail({
        to: email,
        cartData: cart.cart_data,
        locale,
        subscriberId,
      })

      await markCartEmailSent(cart.id)
      await logEmail({ email, type: 'abandoned_cart', resendId, subscriberId })
      recipients.push(email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${cart.email}: ${msg}`)
      console.error('abandoned-cart cron error:', err)
    }
  }

  await notifyFrank({ cron: 'abandoned_cart', sent: recipients.length, recipients, errors })
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
