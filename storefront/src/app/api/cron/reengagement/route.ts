import { NextRequest, NextResponse } from 'next/server'
import { getInactiveSubscribers, logEmail } from '@/lib/marketing-db'
import { sendReengagementEmail, notifyFrank } from '@/lib/resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subscribers = await getInactiveSubscribers(100)
  const recipients: string[] = []
  const errors: string[] = []

  for (const sub of subscribers) {
    try {
      const resendId = await sendReengagementEmail({
        to: sub.email,
        name: sub.name,
        locale: sub.locale,
        subscriberId: sub.id,
      })

      await logEmail({ email: sub.email, type: 'reengagement', resendId, subscriberId: sub.id })
      recipients.push(sub.email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${sub.email}: ${msg}`)
      console.error('reengagement cron error:', err)
    }
  }

  await notifyFrank({ cron: 'reengagement', sent: recipients.length, recipients, errors })
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
