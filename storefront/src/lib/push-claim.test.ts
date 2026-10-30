/**
 * Test del claim dell'endpoint push all'apertura della sessione.
 *
 * Il difetto: una PushSubscription creata da A resta sul browser; se B apre
 * la sessione sullo stesso browser, l'endpoint deve passare a B senza che B
 * si iscriva e senza inviare notifiche. Qui si provano autorizzazione,
 * validazione, trasferimento reale su uno store sintetico e cablaggio.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { handlePushClaim, type PushClaimDeps } from './push-claim'
import { claimBrowserEndpoint } from './account-db'
import {
  maySendToEndpoint,
  takeEndpointOwnership,
  type EndpointOwnership,
} from './push-endpoint'
import { deliverToEmail, type PushDelivery, type PushPayload } from './push'

const E = 'https://push.example.test/E'
const SESSION_EMAIL = 'session@example.test'
const PAYLOAD: PushPayload = { title: 'Ciao', body: 'Corpo', url: '/it/account' }

// ---------------------------------------------------------------------------
// A. handlePushClaim: autorizzazione e validazione con deps finte
// ---------------------------------------------------------------------------

interface ClaimCall {
  email: string
  endpoint: string
}

function fakeDeps(
  sessionValue: { email: string } | null,
  claimImpl?: (email: string, endpoint: string) => Promise<void>,
): { deps: PushClaimDeps; sessionCalls: () => number; claimCalls: ClaimCall[] } {
  let sessionCalls = 0
  const claimCalls: ClaimCall[] = []
  const deps: PushClaimDeps = {
    session: async () => {
      sessionCalls += 1
      return sessionValue
    },
    claim: async (email, endpoint) => {
      claimCalls.push({ email, endpoint })
      if (claimImpl) await claimImpl(email, endpoint)
    },
  }
  return { deps, sessionCalls: () => sessionCalls, claimCalls }
}

test('sessione assente: 401 e claim mai chiamata', async () => {
  const { deps, sessionCalls, claimCalls } = fakeDeps(null)

  const result = await handlePushClaim(deps, { endpoint: E })

  assert.deepEqual(result, { status: 401, body: { error: 'Unauthorized' } })
  assert.equal(sessionCalls(), 1)
  assert.equal(claimCalls.length, 0)
})

test('body o endpoint non validi: 400 e claim mai chiamata', async () => {
  const invalidBodies: unknown[] = [
    null,
    'stringa',
    42,
    [],
    {},
    { endpoint: 42 },
    { endpoint: null },
    { endpoint: '' },
    { endpoint: '   ' },
    { endpoint: 'http://push.example.test/E' },
    { endpoint: 'https://' + 'a'.repeat(2050) },
  ]

  for (const body of invalidBodies) {
    const { deps, sessionCalls, claimCalls } = fakeDeps({ email: SESSION_EMAIL })

    const result = await handlePushClaim(deps, body)

    assert.deepEqual(result, { status: 400, body: { error: 'Invalid endpoint' } })
    assert.equal(sessionCalls(), 1)
    assert.equal(claimCalls.length, 0, `claim non deve partire per body ${JSON.stringify(body)}`)
  }
})

test('endpoint valido con spazi: claim una volta con endpoint ripulito e nessuna email nella risposta', async () => {
  const { deps, claimCalls } = fakeDeps({ email: SESSION_EMAIL })

  const result = await handlePushClaim(deps, { endpoint: `  ${E}  ` })

  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true })
  assert.deepEqual(Object.keys(result.body), ['ok'], 'la risposta non deve contenere email')
  assert.deepEqual(claimCalls, [{ email: SESSION_EMAIL, endpoint: E }])
})

test('claim che lancia: 503, body.ok false e nessuna eccezione propagata', async () => {
  const { deps, claimCalls } = fakeDeps({ email: SESSION_EMAIL }, async () => {
    throw new Error('DB non raggiungibile')
  })

  const result = await handlePushClaim(deps, { endpoint: E })

  assert.deepEqual(result, { status: 503, body: { ok: false } })
  assert.equal(claimCalls.length, 1)
})

test("claim usa l'email della sessione, non quella eventualmente presente nel body", async () => {
  const { deps, claimCalls } = fakeDeps({ email: SESSION_EMAIL })

  const result = await handlePushClaim(deps, { endpoint: E, email: 'altra@example.test' })

  assert.equal(result.status, 200)
  assert.deepEqual(claimCalls, [{ email: SESSION_EMAIL, endpoint: E }])
})

// ---------------------------------------------------------------------------
// B. Scenario reale con due email e un endpoint condiviso
// ---------------------------------------------------------------------------

type Row = { endpoint: string | null }

function normalizedEndpoint(endpoint: string | null): string | null {
  return endpoint === null ? null : endpoint.trim()
}

function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** Stesso contratto di `sqlEndpointOwnership`: trim sull'endpoint, email case-insensitive. */
class MemoryOwnership implements EndpointOwnership {
  readonly rows = new Map<string, Row>()

  set(email: string, endpoint: string | null): void {
    this.rows.set(email, { endpoint: normalizedEndpoint(endpoint) })
  }

  async otherOwners(email: string, endpoint: string): Promise<string[]> {
    const wanted = normalizedEndpoint(endpoint)
    return [...this.rows]
      .filter(([other, row]) => !sameEmail(other, email) && row.endpoint === wanted)
      .map(([other]) => other)
  }

  async releaseOthers(email: string, endpoint: string): Promise<string[]> {
    const wanted = normalizedEndpoint(endpoint)
    const released: string[] = []
    for (const [other, row] of this.rows) {
      if (!sameEmail(other, email) && row.endpoint === wanted) {
        row.endpoint = null
        released.push(other)
      }
    }
    return released
  }
}

/** Deps vere: il claim e' `takeEndpointOwnership` sullo store in memoria. */
function realClaimDeps(
  store: MemoryOwnership,
  email: string,
): { deps: PushClaimDeps; releasedCalls: string[][] } {
  const releasedCalls: string[][] = []
  const deps: PushClaimDeps = {
    session: async () => ({ email }),
    claim: async (owner, endpoint) => {
      releasedCalls.push(await takeEndpointOwnership(store, owner, endpoint))
    },
  }
  return { deps, releasedCalls }
}

class FakeDelivery implements PushDelivery {
  sendCalls: Array<{ subscription: unknown; body: string }> = []
  dropCalls: string[] = []

  constructor(private readonly store: MemoryOwnership) {}

  async maySend(email: string, endpoint: string | null): Promise<boolean> {
    return maySendToEndpoint(this.store, email, endpoint)
  }

  async send(subscription: unknown, body: string): Promise<void> {
    this.sendCalls.push({ subscription, body })
  }

  async drop(email: string): Promise<void> {
    this.dropCalls.push(email)
  }
}

test("il difetto della card: B apre la sessione con E, A perde la proprieta' e B non viene iscritto", async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  const { deps, releasedCalls } = realClaimDeps(store, 'b')

  const result = await handlePushClaim(deps, { endpoint: E })

  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.deepEqual(releasedCalls, [['a']])
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(store.rows.has('b'), false, 'il claim non deve iscrivere B')

  // A non ha piu' una sottoscrizione: la consegna non deve mai chiamare send.
  const delivery = new FakeDelivery(store)
  const sent = await deliverToEmail(delivery, 'a', null, PAYLOAD)
  assert.equal(sent, false)
  assert.equal(delivery.sendCalls.length, 0)
  assert.deepEqual(delivery.dropCalls, [])
})

test('idempotenza: il secondo claim di B non rilascia nessuno e non cambia lo stato', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  const { deps, releasedCalls } = realClaimDeps(store, 'b')

  const first = await handlePushClaim(deps, { endpoint: E })
  const snapshot = [...store.rows].map(([email, row]) => [email, row.endpoint])
  const second = await handlePushClaim(deps, { endpoint: E })

  assert.deepEqual(first, { status: 200, body: { ok: true } })
  assert.deepEqual(second, { status: 200, body: { ok: true } })
  assert.deepEqual(releasedCalls, [['a'], []])
  assert.deepEqual(
    [...store.rows].map(([email, row]) => [email, row.endpoint]),
    snapshot,
  )
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(store.rows.has('b'), false)
})

test("A gia' titolare: il claim non rilascia nessuno e A conserva E", async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  const { deps, releasedCalls } = realClaimDeps(store, 'a')

  const result = await handlePushClaim(deps, { endpoint: E })

  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.deepEqual(releasedCalls, [[]])
  assert.equal(store.rows.get('a')?.endpoint, E)
})

test('stato legacy con due titolari (A e C): il claim di B azzera entrambi', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  store.set('c', E)
  const { deps, releasedCalls } = realClaimDeps(store, 'b')

  const result = await handlePushClaim(deps, { endpoint: E })

  assert.deepEqual(result, { status: 200, body: { ok: true } })
  assert.deepEqual(releasedCalls, [['a', 'c']])
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(store.rows.get('c')?.endpoint, null)
  assert.equal(store.rows.has('b'), false)
})

test('dopo il claim B si iscrive esplicitamente a E: B unico titolare e riceve', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  const { deps } = realClaimDeps(store, 'b')
  await handlePushClaim(deps, { endpoint: E })

  store.set('b', E)
  const released = await takeEndpointOwnership(store, 'b', E)

  assert.deepEqual(released, [])
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(store.rows.get('b')?.endpoint, E)

  const subscription = { endpoint: E, keys: { p256dh: 'p256dh-test', auth: 'auth-test' } }
  const delivery = new FakeDelivery(store)
  const sent = await deliverToEmail(delivery, 'b', subscription, PAYLOAD)

  assert.equal(sent, true)
  assert.equal(delivery.sendCalls.length, 1)
  assert.equal(delivery.sendCalls[0].subscription, subscription)
  assert.equal(delivery.sendCalls[0].body, JSON.stringify(PAYLOAD))
})

// ---------------------------------------------------------------------------
// C. Cablaggio letto dal disco
// ---------------------------------------------------------------------------

test('route push-claim: sessione, claim e handler; nessun invio push', () => {
  const source = readFileSync(
    new URL('../app/api/account/push-claim/route.ts', import.meta.url),
    'utf8',
  )

  // La sessione vera deve essere agganciata come dipendenza, non sostituita.
  assert.match(source, /session:\s*getSession\b/)
  // E `getSession` deve arrivare dal modulo di autenticazione reale.
  assert.match(
    source,
    /import\s*\{[^}]*\bgetSession\b[^}]*\}\s*from\s*['"]@\/lib\/account-auth['"]/,
  )
  assert.match(source, /claimBrowserEndpoint/)
  assert.match(source, /handlePushClaim/)
  assert.doesNotMatch(source, /sendPushToEmail/)
  assert.doesNotMatch(source, /sendNotification/)
  assert.doesNotMatch(source, /web-push/)
  assert.doesNotMatch(source, /from\s+['"]@\/lib\/push['"]/)
})

test('push-claim.ts non importa ne\' usa invio notifiche', () => {
  const source = readFileSync(new URL('./push-claim.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /sendPushToEmail/)
  assert.doesNotMatch(source, /sendNotification/)
  assert.doesNotMatch(source, /web-push/)
  assert.doesNotMatch(source, /webpush/)
})

/** Testo da `marker` alla prima `}` a colonna 0 (chiusura della funzione). */
function functionBlock(source: string, marker: string): string {
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `blocco ${marker} non trovato`)
  const rest = source.slice(start)
  const end = rest.indexOf('\n}')
  assert.notEqual(end, -1, `chiusura di ${marker} non trovata`)
  return rest.slice(0, end + 2)
}

test('account-db: claimBrowserEndpoint usa takeEndpointOwnership e non scrive push_subscription', () => {
  const source = readFileSync(new URL('./account-db.ts', import.meta.url), 'utf8')
  const body = functionBlock(source, 'export async function claimBrowserEndpoint')

  assert.match(body, /takeEndpointOwnership\(/)
  assert.doesNotMatch(body, /push_subscription\s*=/)
})

// ---------------------------------------------------------------------------
// D. Cablaggio client
// ---------------------------------------------------------------------------

test('PushEndpointClaim invia il claim con endpoint esistente e senza iscrivere', () => {
  const source = readFileSync(
    new URL(
      '../app/(customer-app)/account/(protected)/_components/PushEndpointClaim.tsx',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(source, /'\/api\/account\/push-claim'/)
  assert.match(source, /getRegistration/)
  assert.match(source, /getSubscription/)
  // Guardia anti-doppio-invio: la ref deve essere una `useRef`, non un oggetto qualunque.
  assert.match(source, /const\s+claimed\s*=\s*useRef\(false\)/)
  assert.match(source, /if\s*\(claimed\.current\)\s*return/)
  assert.doesNotMatch(source, /pushManager\.subscribe\(/)
  assert.doesNotMatch(source, /Notification\.requestPermission/)
  assert.doesNotMatch(source, /requestPermission\(/)
})

test('layout account monta PushEndpointClaim', () => {
  const source = readFileSync(
    new URL('../app/(customer-app)/account/(protected)/layout.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /PushEndpointClaim/)
  assert.match(source, /<PushEndpointClaim \/>/)
})

test('gate: script package.json e passo CI per il test push-claim', () => {
  const packageSource = readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
  const pkg = JSON.parse(packageSource) as { scripts?: Record<string, string> }

  assert.equal(
    pkg.scripts?.['test:pwa-push-claim'],
    'tsx --test src/lib/push-claim.test.ts',
  )

  const ciSource = readFileSync(
    new URL('../../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  assert.match(ciSource, /npm run test:pwa-push-claim --silent/)
})

// ---------------------------------------------------------------------------
// E. La funzione di produzione rilascia davvero
// ---------------------------------------------------------------------------

/**
 * Fedele all'adattatore SQL: `btrim` e' applicato solo alla colonna, il
 * parametro arriva com'e'. Serve a provare che la produzione normalizza
 * l'endpoint prima di passarlo al claim.
 */
class SqlFaithfulOwnership extends MemoryOwnership {
  readonly releasedEmails: string[] = []

  override async otherOwners(email: string, endpoint: string): Promise<string[]> {
    return [...this.rows]
      .filter(([other, row]) => !sameEmail(other, email) && row.endpoint === endpoint)
      .map(([other]) => other)
  }

  override async releaseOthers(email: string, endpoint: string): Promise<string[]> {
    const released: string[] = []
    for (const [other, row] of this.rows) {
      if (!sameEmail(other, email) && row.endpoint === endpoint) {
        row.endpoint = null
        released.push(other)
      }
    }
    this.releasedEmails.push(...released)
    return released
  }
}

test("E. A ha E, B apre la sessione: la funzione di produzione rilascia A e non iscrive B", async () => {
  const store = new MemoryOwnership()
  store.set('a', E)

  const released = await claimBrowserEndpoint('b', E, store)

  assert.deepEqual(released, ['a'])
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(store.rows.has('b'), false, 'il claim non deve iscrivere B')
})

test('E. endpoint vuoto o di soli spazi: nessun rilascio e A conserva E', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)

  assert.deepEqual(await claimBrowserEndpoint('b', '', store), [])
  assert.deepEqual(await claimBrowserEndpoint('b', '   ', store), [])
  assert.equal(store.rows.get('a')?.endpoint, E)
})

test('E. email case-insensitive: il titolare non rilascia se stesso', async () => {
  const store = new MemoryOwnership()
  store.set('a@example.test', E)

  const released = await claimBrowserEndpoint('A@Example.Test', E, store)

  assert.deepEqual(released, [])
  assert.equal(store.rows.get('a@example.test')?.endpoint, E)
})

test('E. endpoint con spazi: subscriptionEndpoint lo normalizza e A viene rilasciato', async () => {
  const storeSqlFaithful = new SqlFaithfulOwnership()
  storeSqlFaithful.set('a', E)

  const released = await claimBrowserEndpoint('b', `  ${E}  `, storeSqlFaithful)

  assert.deepEqual(released, ['a'])
  assert.deepEqual(storeSqlFaithful.releasedEmails, ['a'])
  assert.equal(storeSqlFaithful.rows.get('a')?.endpoint, null)
})

test('E. il ramo di produzione resta quello SQL', () => {
  const source = readFileSync(new URL('./account-db.ts', import.meta.url), 'utf8')

  // Tollerante a spazi e righe: una riformattazione legittima non deve far fallire il test.
  assert.match(source, /ownership\s*\?\?\s*sqlEndpointOwnership\(/)
})

test('E. la route aggancia claimBrowserEndpoint come dipendenza claim, senza ownership iniettato', () => {
  const source = readFileSync(
    new URL('../app/api/account/push-claim/route.ts', import.meta.url),
    'utf8',
  )

  // Il claim vero deve essere la dipendenza `claim`: importarlo o nominarlo altrove non basta.
  assert.match(source, /claim:\s*claimBrowserEndpoint\b/)
  // In produzione non si inietta un ownership finto: la funzione non viene chiamata con argomenti.
  assert.doesNotMatch(source, /claimBrowserEndpoint\s*\(/)
})
