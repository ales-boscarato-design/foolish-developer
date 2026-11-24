/**
 * Decisione di lettura della risposta di /api/subscribe/checkout.
 *
 * Il client non deve fidarsi della forma del corpo: su 400/503 il server
 * risponde con `{ error }`, una rete rotta o un proxy possono restituire HTML,
 * e `res.json()` lancerebbe con un body non JSON. Qui la regola e' unica e
 * totale: si apre il checkout solo con 200 e un `checkoutUrl` stringa non vuoto;
 * ogni altra combinazione e' un errore da mostrare all'utente.
 */
export type SubscriptionCheckoutResult = { checkoutUrl: string } | { error: true }

export function parseSubscriptionCheckoutResponse(status: number, body: unknown): SubscriptionCheckoutResult {
  if (status !== 200) return { error: true }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: true }
  const { checkoutUrl } = body as { checkoutUrl?: unknown }
  if (typeof checkoutUrl !== 'string' || checkoutUrl.trim().length === 0) return { error: true }
  return { checkoutUrl }
}
