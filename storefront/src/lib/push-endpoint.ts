/**
 * Proprieta' dell'endpoint push.
 *
 * Una PushSubscription appartiene al BROWSER, non all'email: lo stesso endpoint
 * puo' comparire su piu' righe di `marketing.subscribers`. Questo modulo tiene
 * la regola "un endpoint ha un solo titolare" (last writer wins) e la verifica
 * fail-closed usata al momento dell'invio.
 */

/** Tag template compatibile con postgres.js: i test iniettano un finto. */
export type SqlTag = <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>

/** Endpoint di una PushSubscription; null se la forma non e' valida. */
export function subscriptionEndpoint(subscription: unknown): string | null {
  if (typeof subscription !== 'object' || subscription === null) return null
  const endpoint = (subscription as { endpoint?: unknown }).endpoint
  if (typeof endpoint !== 'string') return null
  const trimmed = endpoint.trim()
  return trimmed === '' ? null : trimmed
}

export interface EndpointOwnership {
  /** email (diverse da `email`) che dichiarano lo stesso endpoint */
  otherOwners(email: string, endpoint: string): Promise<string[]>
  /** azzera push_subscription delle ALTRE email che dichiarano l'endpoint; ritorna le email azzerate */
  releaseOthers(email: string, endpoint: string): Promise<string[]>
}

/** Adattatore SQL sul vero schema. */
export function sqlEndpointOwnership(sql: SqlTag): EndpointOwnership {
  return {
    async otherOwners(email: string, endpoint: string): Promise<string[]> {
      const rows = await sql<{ email: string }>`
        SELECT email FROM marketing.subscribers
        WHERE push_subscription IS NOT NULL
          AND btrim(push_subscription->>'endpoint') = ${endpoint}
          AND lower(email) <> lower(${email})
      `
      return rows.map((row) => row.email)
    },

    async releaseOthers(email: string, endpoint: string): Promise<string[]> {
      const rows = await sql<{ email: string }>`
        UPDATE marketing.subscribers
        SET push_subscription = NULL, updated_at = NOW()
        WHERE btrim(push_subscription->>'endpoint') = ${endpoint}
          AND lower(email) <> lower(${email})
        RETURNING email
      `
      return rows.map((row) => row.email)
    },
  }
}

/** D1: rende `email` unico titolare dell'endpoint. No-op se `endpoint` e' null/vuoto. */
export async function takeEndpointOwnership(
  o: EndpointOwnership,
  email: string,
  endpoint: string | null,
): Promise<string[]> {
  if (endpoint === null || endpoint.trim() === '') return []
  return o.releaseOthers(email, endpoint)
}

/** D2: true solo se nessun'altra email dichiara l'endpoint. Endpoint null/vuoto -> false. */
export async function maySendToEndpoint(
  o: EndpointOwnership,
  email: string,
  endpoint: string | null,
): Promise<boolean> {
  if (endpoint === null || endpoint.trim() === '') return false
  const owners = await o.otherOwners(email, endpoint)
  return owners.length === 0
}
