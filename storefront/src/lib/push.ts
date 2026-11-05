import webpush from 'web-push'
import sql from './db'
import {
  maySendToEndpoint,
  sqlEndpointOwnership,
  subscriptionEndpoint,
  type SqlTag,
} from './push-endpoint'

// Lazy init: setVapidDetails runs only at request time, not during build.
let initialized = false
function wp() {
  if (!initialized) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT!,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )
    initialized = true
  }
  return webpush
}

export interface PushPayload {
  title: string
  body: string
  url?: string
}

export interface PushDelivery {
  /** true solo se `email` e' l'unico titolare dell'endpoint (D2). */
  maySend(email: string, endpoint: string | null): Promise<boolean>
  /** invia la notifica; lancia in caso di errore (contratto di web-push). */
  send(subscription: webpush.PushSubscription, body: string): Promise<void>
  /** azzera la sottoscrizione diventata invalida (410/404). */
  drop(email: string): Promise<void>
}

/** true se l'errore segnala una sottoscrizione non piu' valida (410/404). */
function isGoneSubscription(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return false
  const statusCode = (err as { statusCode?: unknown }).statusCode
  return statusCode === 410 || statusCode === 404
}

/**
 * Decides and performs one delivery. Never throws: every failure (ownership
 * check, transient DB error, web-push error) is reported as `false` so that a
 * batch sender cannot be taken down by a single subscriber.
 */
export async function deliverToEmail(
  delivery: PushDelivery,
  email: string,
  subscription: unknown,
  payload: PushPayload,
): Promise<boolean> {
  const endpoint = subscriptionEndpoint(subscription)

  let owned: boolean
  try {
    owned = await delivery.maySend(email, endpoint)
  } catch {
    // DB transitorio: fail-closed, non inviare.
    return false
  }
  if (!owned) return false

  try {
    await delivery.send(subscription as webpush.PushSubscription, JSON.stringify(payload))
    return true
  } catch (err: unknown) {
    if (isGoneSubscription(err)) {
      try {
        await delivery.drop(email)
      } catch {
        // Un errore del cleanup non deve propagare.
      }
    }
    return false
  }
}

export async function sendPushToEmail(email: string, payload: PushPayload): Promise<boolean> {
  const rows = await sql<{ push_subscription: unknown }[]>`
    SELECT push_subscription FROM marketing.subscribers
    WHERE email = ${email} AND push_subscription IS NOT NULL
    LIMIT 1
  `
  if (!rows.length || !rows[0]?.push_subscription) return false

  const delivery: PushDelivery = {
    maySend: (owner, endpoint) =>
      maySendToEndpoint(
        // PendingQuery di postgres.js e' un thenable; il cast e' solo di tipo.
        sqlEndpointOwnership(sql as unknown as SqlTag),
        owner,
        endpoint
      ),
    send: async (subscription, body) => {
      await wp().sendNotification(subscription, body)
    },
    drop: async (owner) => {
      await sql`
        UPDATE marketing.subscribers SET push_subscription = NULL
        WHERE email = ${owner}
      `
    },
  }

  return deliverToEmail(delivery, email, rows[0].push_subscription, payload)
}
