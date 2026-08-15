import { createHmac } from 'crypto'

/**
 * POST a signed webhook to nanobot.
 * Adds `x-foolish-signature: sha256=<hmac>` using NANOBOT_WEBHOOK_SECRET.
 * If the secret is not configured, no unsigned request is sent.
 */
export async function notifyNanobot(
  path: string,
  payload: object,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const base = process.env.NANOBOT_WEBHOOK_URL
  if (!base) return

  const body = JSON.stringify(payload)
  const secret = process.env.NANOBOT_WEBHOOK_SECRET
  if (!secret) {
    console.error(`nanobot ${path} notify skipped: NANOBOT_WEBHOOK_SECRET is not configured`)
    return
  }
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const sig = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

  await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-foolish-timestamp': timestamp,
      'x-foolish-signature': sig,
    },
    body,
    signal: opts?.signal,
  }).catch((e) => console.error(`nanobot ${path} notify failed:`, e))
}
