import { NextRequest, NextResponse } from 'next/server'
import { getPendingPwaInvites, markPwaInviteSent, isSubscriberBlocked, logEmail } from '@/lib/marketing-db'
import { sendPwaInviteEmail, notifyFrank } from '@/lib/resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const pending = await getPendingPwaInvites()
  const recipients: string[] = []
  const errors: string[] = []

  for (const row of pending) {
    try {
      const blocked = await isSubscriberBlocked(row.email)
      if (blocked) {
        await markPwaInviteSent(row.id)
        continue
      }

      const resendId = await sendPwaInviteEmail({
        to: row.email,
        name: row.name,
        locale: row.locale,
        subscriberId: row.subscriber_id,
      })

      await markPwaInviteSent(row.id)
      await logEmail({ email: row.email, type: 'pwa_invite', resendId, subscriberId: row.subscriber_id })
      recipients.push(row.email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${row.email}: ${msg}`)
      console.error('pwa-invite cron error:', err)
    }
  }

  if (recipients.length > 0 || errors.length > 0) {
    await notifyFrank({ cron: 'pwa_invite', sent: recipients.length, recipients, errors })
  }
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
