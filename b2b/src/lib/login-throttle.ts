/**
 * Lockout del login B2B.
 *
 * Modello a eventi: ogni fallimento e' una riga con timestamp e il blocco si
 * calcola contando gli eventi nella finestra. La decisione e' pura e vive qui,
 * cosi' si puo' testare senza database; gli store registrano solo i fatti.
 *
 * Il client postgres.js e' iniettato di proposito: questo modulo non importa
 * `db.ts` e resta caricabile anche quando `DATABASE_URL` non esiste.
 */

export type ThrottleKeyKind = 'identity' | 'ip'

export interface ThrottleCounters {
  recent: number
  day: number
  lastFailureAt: Date | null
}

export interface LoginAttemptStore {
  recordFailures(keys: string[], now: Date): Promise<void>
  countWindows(keys: string[], now: Date): Promise<Map<string, ThrottleCounters>>
  recordCheck(key: string, now: Date): Promise<void>
  reset(keys: string[]): Promise<void>
}

export interface ThrottleDecision {
  blocked: boolean
  retryAfterSeconds: number
}

/** Client postgres.js iniettato (default export di `db.ts` nei chiamanti reali). */
export interface SqlClient {
  (strings: TemplateStringsArray, ...values: any[]): Promise<any>
}

/** Soglie e finestre della policy, tutte in millisecondi. */
export const IDENTITY_MAX_RECENT = 5
export const IDENTITY_WINDOW_MS = 30 * 60 * 1000
export const IP_MAX_RECENT = 20
export const IP_WINDOW_MS = 30 * 60 * 1000
export const CHECK_IP_MAX_RECENT = 60
export const CHECK_IP_WINDOW_MS = 30 * 60 * 1000
export const DAY_WINDOW_MS = 24 * 60 * 60 * 1000

// Le tre finestre "recenti" coincidono: lo store espone un solo conteggio e la
// soglia la sceglie il chiamante in base al tipo di chiave.
const RECENT_WINDOW_MS = IDENTITY_WINDOW_MS

const BLOCK_SHORT_MS = 30 * 60 * 1000
const BLOCK_MEDIUM_MS = 2 * 60 * 60 * 1000
const BLOCK_LONG_MS = DAY_WINDOW_MS

export function identityKey(email: string): string {
  return `email:${email.toLowerCase().trim()}`
}

/**
 * L'ultima voce di `x-forwarded-for` e' quella appesa dal proxy piu' vicino:
 * le precedenti le puo' inventare il client e non sono affidabili per il
 * throttling. `x-real-ip` e' il ripiego quando il proxy non valorizza XFF.
 * Il parsing vive qui una volta sola: le chiavi cambiano solo prefisso.
 */
function ipFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for') ?? ''
  const hops = forwarded
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0)
  if (hops.length > 0) return hops[hops.length - 1]

  const realIp = (headers.get('x-real-ip') ?? '').trim()
  if (realIp) return realIp

  return 'unknown'
}

/** Chiave dei fallimenti di login per IP. */
export function ipKeyFromHeaders(headers: Headers): string {
  return `ip:${ipFromHeaders(headers)}`
}

/**
 * Chiave separata del passo `check`: la soglia dei check (60) non deve
 * sommarsi a quella dei fallimenti di login (20), altrimenti venti `check`
 * bloccherebbero un login ancora sotto la soglia dei fallimenti.
 */
export function checkKeyFromHeaders(headers: Headers): string {
  return `ipcheck:${ipFromHeaders(headers)}`
}

function maxRecentFor(kind: ThrottleKeyKind): number {
  return kind === 'identity' ? IDENTITY_MAX_RECENT : IP_MAX_RECENT
}

/**
 * La durata cresce con i fallimenti nelle 24 ore: e' un freno progressivo, non
 * una punizione permanente. Sotto i 5 fallimenti non c'e' blocco.
 */
function blockDurationMs(dayFailures: number): number {
  if (dayFailures >= 20) return BLOCK_LONG_MS
  if (dayFailures >= 10) return BLOCK_MEDIUM_MS
  if (dayFailures >= 5) return BLOCK_SHORT_MS
  return 0
}

function decided(counters: ThrottleCounters | undefined, maxRecent: number, now: Date): ThrottleDecision {
  if (!counters || counters.lastFailureAt === null) {
    return { blocked: false, retryAfterSeconds: 0 }
  }
  if (counters.recent < maxRecent) {
    return { blocked: false, retryAfterSeconds: 0 }
  }

  const duration = blockDurationMs(counters.day)
  if (duration === 0) {
    return { blocked: false, retryAfterSeconds: 0 }
  }

  const end = counters.lastFailureAt.getTime() + duration
  if (now.getTime() >= end) {
    return { blocked: false, retryAfterSeconds: 0 }
  }

  // Minimo 1: Retry-After 0 inviterebbe al retry immediato proprio mentre il
  // blocco e' ancora attivo.
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((end - now.getTime()) / 1000)),
  }
}

export function decideBlock(
  counters: ThrottleCounters | undefined,
  kind: ThrottleKeyKind,
  now: Date,
): ThrottleDecision {
  return decided(counters, maxRecentFor(kind), now)
}

/**
 * Basta una chiave bloccata per fermare la richiesta. Si restituisce l'attesa
 * piu' lunga fra quelle attive: e' quella che l'utente deve davvero rispettare.
 */
export function decideAnyBlock(
  entries: { kind: ThrottleKeyKind; counters?: ThrottleCounters }[],
  now: Date,
): ThrottleDecision {
  let longest = 0
  for (const entry of entries) {
    const decision = decideBlock(entry.counters, entry.kind, now)
    if (decision.blocked) longest = Math.max(longest, decision.retryAfterSeconds)
  }
  return longest > 0
    ? { blocked: true, retryAfterSeconds: longest }
    : { blocked: false, retryAfterSeconds: 0 }
}

/**
 * Il passo `check` ha una soglia solo-IP piu' alta: resta un oracolo di
 * enumerazione noto (la risposta `{ exists }` non cambia), ma non deve poter
 * martellare il database all'infinito.
 */
export function decideCheckBlock(
  counters: ThrottleCounters | undefined,
  now: Date,
): ThrottleDecision {
  return decided(counters, CHECK_IP_MAX_RECENT, now)
}

function windowsFrom(events: Date[], now: Date): ThrottleCounters {
  const recentCutoff = now.getTime() - RECENT_WINDOW_MS
  const dayCutoff = now.getTime() - DAY_WINDOW_MS
  const recent = events.filter((time) => time.getTime() >= recentCutoff)
  const day = events.filter((time) => time.getTime() >= dayCutoff)
  const lastFailureAt = day.reduce<Date | null>(
    (max, time) => (max === null || time.getTime() > max.getTime() ? time : max),
    null,
  )
  return { recent: recent.length, day: day.length, lastFailureAt }
}

/**
 * Store di riferimento per i test e per un singolo processo. Non e' condiviso
 * fra istanze: in produzione serve lo store Postgres.
 */
export function createMemoryStore(): LoginAttemptStore {
  const events = new Map<string, Date[]>()

  function record(keys: string[], now: Date): void {
    const cutoff = now.getTime() - DAY_WINDOW_MS
    for (const key of keys) {
      const kept = (events.get(key) ?? []).filter((time) => time.getTime() >= cutoff)
      kept.push(new Date(now))
      events.set(key, kept)
    }
  }

  return {
    async recordFailures(keys, now) {
      record(keys, now)
    },

    async countWindows(keys, now) {
      const result = new Map<string, ThrottleCounters>()
      for (const key of keys) {
        result.set(key, windowsFrom(events.get(key) ?? [], now))
      }
      return result
    },

    async recordCheck(key, now) {
      record([key], now)
    },

    async reset(keys) {
      for (const key of keys) events.delete(key)
    },
  }
}

interface AttemptRow {
  throttle_key: string
  recent: number
  day: number
  last_failure_at: Date | null
}

/**
 * Store condiviso su Postgres. La lettura e' una sola query con GROUP BY: due
 * query per chiave sarebbero piu' facili da leggere ma raddoppierebbero i
 * round-trip a ogni tentativo, che e' proprio il percorso da proteggere.
 */
export function createPostgresStore(sqlClient: SqlClient): LoginAttemptStore {
  return {
    async recordFailures(keys, now) {
      if (keys.length === 0) return

      // Pulizia opportunistica: la finestra di 24h e' l'unica che interessa e
      // la tabella non deve crescere senza limite.
      const oldest = new Date(now.getTime() - DAY_WINDOW_MS)
      await sqlClient`
        DELETE FROM b2b_login_attempts
        WHERE attempted_at < ${oldest}
      `

      // Due sole chiavi per fallimento: il ciclo e' piu' leggibile di una
      // INSERT con unnest e il costo resta trascurabile.
      for (const key of keys) {
        await sqlClient`
          INSERT INTO b2b_login_attempts (throttle_key, attempted_at)
          VALUES (${key}, ${now})
        `
      }
    },

    async countWindows(keys, now) {
      const result = new Map<string, ThrottleCounters>()
      if (keys.length === 0) return result

      const recentCutoff = new Date(now.getTime() - RECENT_WINDOW_MS)
      const dayCutoff = new Date(now.getTime() - DAY_WINDOW_MS)
      const rows = (await sqlClient`
        SELECT
          throttle_key,
          (COUNT(*) FILTER (WHERE attempted_at >= ${recentCutoff}))::int AS recent,
          (COUNT(*) FILTER (WHERE attempted_at >= ${dayCutoff}))::int AS day,
          MAX(attempted_at) AS last_failure_at
        FROM b2b_login_attempts
        WHERE throttle_key = ANY(${keys}::text[])
          AND attempted_at >= ${dayCutoff}
        GROUP BY throttle_key
      `) as AttemptRow[]

      for (const row of rows) {
        result.set(row.throttle_key, {
          recent: Number(row.recent),
          day: Number(row.day),
          lastFailureAt: row.last_failure_at,
        })
      }
      return result
    },

    async recordCheck(key, now) {
      await sqlClient`
        INSERT INTO b2b_login_attempts (throttle_key, attempted_at)
        VALUES (${key}, ${now})
      `
    },

    async reset(keys) {
      if (keys.length === 0) return
      await sqlClient`
        DELETE FROM b2b_login_attempts
        WHERE throttle_key = ANY(${keys}::text[])
      `
    },
  }
}

export async function ensureLoginThrottleTable(sqlClient: SqlClient): Promise<void> {
  await sqlClient`
    CREATE TABLE IF NOT EXISTS b2b_login_attempts (
      id BIGSERIAL PRIMARY KEY,
      throttle_key TEXT NOT NULL,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  await sqlClient`
    CREATE INDEX IF NOT EXISTS b2b_login_attempts_key_time_idx
      ON b2b_login_attempts (throttle_key, attempted_at DESC)
  `
}
