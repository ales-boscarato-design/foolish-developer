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
    let stage = 'checking subscriber status'
    try {
      const blocked = await isSubscriberBlocked(row.email)
      if (blocked) {
        stage = 'marking blocked invite as handled'
        await markPwaInviteSent(row.id)
        continue
      }

      stage = 'sending invite email'
      const resendId = await sendPwaInviteEmail({
        to: row.email,
        name: row.name,
        locale: row.locale,
        subscriberId: row.subscriber_id,
      })

      // Mark first to avoid duplicate sends if the non-transactional email log
      // insert fails. The SQL migration explicitly permits the pwa_invite type.
      stage = 'marking invite as sent'
      await markPwaInviteSent(row.id)
      stage = 'writing email log'
      await logEmail({ email: row.email, type: 'pwa_invite', resendId, subscriberId: row.subscriber_id })
      recipients.push(row.email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${row.email} (${stage}): ${msg}`)
      console.error('pwa-invite cron error:', { queueId: row.id, email: row.email, stage, error: err })
    }
  }

  if (recipients.length > 0 || errors.length > 0) {
    await notifyFrank({ cron: 'pwa_invite', sent: recipients.length, recipients, errors })
  }
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
