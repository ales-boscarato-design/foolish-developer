import webpush from 'web-push'
import sql from './db'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export interface PushPayload {
  title: string
  body: string
  url?: string
}

export async function sendPushToEmail(email: string, payload: PushPayload): Promise<boolean> {
  const rows = await sql<{ push_subscription: unknown }[]>`
    SELECT push_subscription FROM marketing.subscribers
    WHERE email = ${email} AND push_subscription IS NOT NULL
    LIMIT 1
  `
  if (!rows.length || !rows[0]?.push_subscription) return false

  try {
    await webpush.sendNotification(
      rows[0].push_subscription as webpush.PushSubscription,
      JSON.stringify(payload)
    )
    return true
  } catch (err: unknown) {
    // Subscription expired or invalid — clear it
    if (typeof err === 'object' && err !== null && 'statusCode' in err) {
      const statusCode = (err as { statusCode: number }).statusCode
      if (statusCode === 410 || statusCode === 404) {
        await sql`
          UPDATE marketing.subscribers SET push_subscription = NULL
          WHERE email = ${email}
        `
      }
    }
    return false
  }
}
