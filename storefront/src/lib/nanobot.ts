import { createHmac } from 'crypto'

/**
 * POST a signed webhook to nanobot.
 * Adds `x-foolish-signature: sha256=<hmac>` using NANOBOT_WEBHOOK_SECRET.
 * If the secret is not configured the header is omitted (nanobot accepts unsigned requests).
 */
export async function notifyNanobot(
  path: string,
  payload: object,
  opts?: { signal?: AbortSignal },
): Promise<void> {
  const base = process.env.NANOBOT_WEBHOOK_URL
  if (!base) return

  const body = JSON.stringify(payload)
  const secret = process.env.NANOBOT_WEBHOOK_SECRET ?? ''
  const sig = secret
    ? 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
    : ''

  await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sig ? { 'x-foolish-signature': sig } : {}),
    },
    body,
    signal: opts?.signal,
  }).catch((e) => console.error(`nanobot ${path} notify failed:`, e))
}
