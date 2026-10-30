/**
 * Claim dell'endpoint push all'apertura della sessione.
 *
 * Modulo puro: nessun accesso a DB, a Next o alla libreria di invio. Il
 * trasferimento di proprieta' e' iniettato da chi chiama; qui si applicano
 * solo autorizzazione e validazione, senza iscrivere nessuno e senza inviare
 * notifiche.
 */

export interface PushClaimDeps {
  /** sessione corrente; null se non autenticato */
  session(): Promise<{ email: string } | null>
  /** rende `email` titolare dell'endpoint azzerando le altre email; NON deve scrivere la riga di `email`. */
  claim(email: string, endpoint: string): Promise<unknown>
}

export interface PushClaimResult {
  status: number
  body: Record<string, unknown>
}

const MAX_ENDPOINT_LENGTH = 2048

export async function handlePushClaim(deps: PushClaimDeps, body: unknown): Promise<PushClaimResult> {
  const session = await deps.session()
  if (session === null) return { status: 401, body: { error: 'Unauthorized' } }

  // Il body deve essere un oggetto vero: array e null non sono validi.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { status: 400, body: { error: 'Invalid endpoint' } }
  }

  const rawEndpoint = (body as { endpoint?: unknown }).endpoint
  if (typeof rawEndpoint !== 'string') {
    return { status: 400, body: { error: 'Invalid endpoint' } }
  }

  const endpoint = rawEndpoint.trim()
  if (endpoint === '' || endpoint.length > MAX_ENDPOINT_LENGTH) {
    return { status: 400, body: { error: 'Invalid endpoint' } }
  }
  if (!endpoint.startsWith('https://')) {
    return { status: 400, body: { error: 'Invalid endpoint' } }
  }

  try {
    await deps.claim(session.email, endpoint)
  } catch {
    // DB non raggiungibile: il client puo' riprovare alla prossima apertura.
    return { status: 503, body: { ok: false } }
  }

  // Nessuna email (ne' rilasciata ne' titolare) nella risposta.
  return { status: 200, body: { ok: true } }
}
