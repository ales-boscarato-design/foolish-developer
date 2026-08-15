import { createHmac } from 'crypto'

/**
 * POST a signed webhook to nanobot.
 * Adds `x-foolish-signature: sha256=<hmac>` using NANOBOT_WEBHOOK_SECRET.
 * If the secret is not configured, no unsigned request is sent.
 */
export async function notifyNanobot(
  path: string,
  payload: object,
  opts?: { signal?: AbortSignal; throwOnError?: boolean },
): Promise<void> {
  const base = process.env.NANOBOT_WEBHOOK_URL
  if (!base) {
    const error = new Error(`nanobot ${path} notify failed: NANOBOT_WEBHOOK_URL is not configured`)
    console.error(error.message)
    if (opts?.throwOnError) throw error
    return
  }

  const body = JSON.stringify(payload)
  const secret = process.env.NANOBOT_WEBHOOK_SECRET
  if (!secret) {
    const error = new Error(`nanobot ${path} notify failed: NANOBOT_WEBHOOK_SECRET is not configured`)
    console.error(error.message)
    if (opts?.throwOnError) throw error
    return
  }
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const sig = 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

  try {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-foolish-timestamp': timestamp,
        'x-foolish-signature': sig,
      },
      body,
      signal: opts?.signal,
    })
    if (!response.ok) {
      throw new Error(`nanobot ${path} returned ${response.status}: ${await response.text()}`)
    }
  } catch (error) {
    console.error(`nanobot ${path} notify failed:`, error)
    if (opts?.throwOnError) throw error
  }
}
