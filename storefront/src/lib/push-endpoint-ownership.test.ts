/**
 * Test della proprieta' dell'endpoint push (card t_e53f9974).
 *
 * Il difetto: una PushSubscription appartiene al browser, ma era salvata per
 * email. Se A e B usano lo stesso browser, l'endpoint E finiva su due righe e
 * `sendPushToEmail('a')` consegnava al dispositivo di B. Qui si prova:
 * - l'estrazione dell'endpoint;
 * - la regola D1 (last writer wins) su uno store sintetico;
 * - il fail-closed D2, anche sullo stato legacy con due titolari;
 * - l'SQL realmente prodotto dall'adattatore (parametri, non interpolazione);
 * - il cablaggio nei file di produzione, letto dal disco.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  maySendToEndpoint,
  sqlEndpointOwnership,
  subscriptionEndpoint,
  takeEndpointOwnership,
  type EndpointOwnership,
  type SqlTag,
} from './push-endpoint'
import { deliverToEmail, type PushDelivery, type PushPayload } from './push'

// ---------------------------------------------------------------------------
// A. Estrazione dell'endpoint
// ---------------------------------------------------------------------------

test('subscriptionEndpoint estrae solo endpoint stringa non vuoti', () => {
  assert.equal(
    subscriptionEndpoint({ endpoint: 'https://push.example.test/E' }),
    'https://push.example.test/E',
  )
  assert.equal(
    subscriptionEndpoint({ endpoint: '  https://push.example.test/E  ' }),
    'https://push.example.test/E',
  )
  assert.equal(subscriptionEndpoint({ endpoint: '' }), null)
  assert.equal(subscriptionEndpoint({ endpoint: '   ' }), null)
  assert.equal(subscriptionEndpoint({ endpoint: 42 }), null)
  assert.equal(subscriptionEndpoint({ endpoint: null }), null)
  assert.equal(subscriptionEndpoint({}), null)
  assert.equal(subscriptionEndpoint(null), null)
  assert.equal(subscriptionEndpoint(undefined), null)
  assert.equal(subscriptionEndpoint(42), null)
  assert.equal(subscriptionEndpoint('https://push.example.test/E'), null)
  assert.equal(subscriptionEndpoint([]), null)
})

// ---------------------------------------------------------------------------
// B. Regola D1/D2 su uno store sintetico in memoria
// ---------------------------------------------------------------------------

type Row = { endpoint: string | null }

/**
 * Sul DB il confronto e' `btrim(push_subscription->>'endpoint')`: lo store
 * sintetico normalizza con trim sia in scrittura sia nel confronto, cosi' un
 * endpoint memorizzato con spazi ai bordi e' lo stesso endpoint.
 */
function normalizedEndpoint(endpoint: string | null): string | null {
  return endpoint === null ? null : endpoint.trim()
}

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

/** Postgres confronta `lower(email) <> lower(...)`: lo store sintetico fa lo stesso. */
function sameEmail(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

const E = 'https://push.example.test/E'

test('A si iscrive a E: nessun altro titolare da azzerare', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)

  const released = await takeEndpointOwnership(store, 'a', E)

  assert.deepEqual(released, [])
  assert.equal(store.rows.get('a')?.endpoint, E)
})

test("B si iscrive a E: azzera A, poi solo B puo' ricevere", async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  await takeEndpointOwnership(store, 'a', E)

  store.set('b', E)
  const released = await takeEndpointOwnership(store, 'b', E)

  assert.deepEqual(released, ['a'])
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(await maySendToEndpoint(store, 'a', E), false)
  assert.equal(await maySendToEndpoint(store, 'b', E), true)
})

test('endpoint con spazi ai bordi: e\' lo stesso endpoint, B azzera A', async () => {
  const store = new MemoryOwnership()
  // La riga salvata puo' contenere spazi (JSON crudo): btrim lato DB e trim
  // nel finto devono considerarla lo stesso endpoint di `E`.
  store.set('a', `  ${E}  `)
  store.set('b', ` ${E} `)

  const released = await takeEndpointOwnership(store, 'b', E)

  assert.deepEqual(released, ['a'])
  assert.equal(store.rows.get('a')?.endpoint, null)
  assert.equal(await maySendToEndpoint(store, 'a', ` ${E} `), false)
  assert.equal(await maySendToEndpoint(store, 'b', E), true)
})

test('A si riscrive su E: azzera B (last writer wins, non primo arrivato)', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  store.set('b', E)
  await takeEndpointOwnership(store, 'b', E)

  store.set('a', E)
  const released = await takeEndpointOwnership(store, 'a', E)

  assert.deepEqual(released, ['b'])
  assert.equal(store.rows.get('b')?.endpoint, null)
  assert.equal(await maySendToEndpoint(store, 'a', E), true)
  assert.equal(await maySendToEndpoint(store, 'b', E), false)
})

test('endpoint diversi: nessuno viene azzerato, entrambi ricevono', async () => {
  const store = new MemoryOwnership()
  const E1 = 'https://push.example.test/E1'
  const E2 = 'https://push.example.test/E2'
  store.set('a', E1)
  store.set('b', E2)

  assert.deepEqual(await takeEndpointOwnership(store, 'a', E1), [])
  assert.deepEqual(await takeEndpointOwnership(store, 'b', E2), [])

  assert.equal(store.rows.get('a')?.endpoint, E1)
  assert.equal(store.rows.get('b')?.endpoint, E2)
  assert.equal(await maySendToEndpoint(store, 'a', E1), true)
  assert.equal(await maySendToEndpoint(store, 'b', E2), true)
})

test('stato legacy con due titolari (email diverse): fail-closed per entrambi', async () => {
  const store = new MemoryOwnership()
  store.set('a', E)
  store.set('b', E)

  assert.equal(await maySendToEndpoint(store, 'a', E), false)
  assert.equal(await maySendToEndpoint(store, 'b', E), false)
})

test('email case-insensitive: A@ e a@ sono lo stesso titolare, non si bloccano', async () => {
  const store = new MemoryOwnership()
  store.set('A@example.test', E)

  // `lower(email) <> lower(...)`: la variante di case e' la stessa email, non
  // un "altro titolare". Il fail-closed resta per email realmente diverse.
  assert.equal(await maySendToEndpoint(store, 'a@example.test', E), true)
  assert.equal(await maySendToEndpoint(store, 'A@example.test', E), true)
  assert.deepEqual(await takeEndpointOwnership(store, 'a@example.test', E), [])
  assert.equal(store.rows.get('A@example.test')?.endpoint, E)
})

test('un secondo titolare con email diversa azzera anche le varianti di case', async () => {
  const store = new MemoryOwnership()
  store.set('A@example.test', E)
  store.set('a@example.test', E)
  store.set('B@example.test', E)

  const released = await takeEndpointOwnership(store, 'B@example.test', E)

  assert.deepEqual(released, ['A@example.test', 'a@example.test'])
  assert.equal(store.rows.get('A@example.test')?.endpoint, null)
  assert.equal(store.rows.get('a@example.test')?.endpoint, null)
  assert.equal(await maySendToEndpoint(store, 'B@example.test', E), true)
})

test("endpoint null/vuoto: take e' no-op, maySend e' false", async () => {
  const store = new MemoryOwnership()
  store.set('a', E)

  let releaseCalls = 0
  const spy: EndpointOwnership = {
    otherOwners: (email, endpoint) => store.otherOwners(email, endpoint),
    releaseOthers: (email, endpoint) => {
      releaseCalls += 1
      return store.releaseOthers(email, endpoint)
    },
  }

  assert.deepEqual(await takeEndpointOwnership(spy, 'a', null), [])
  assert.deepEqual(await takeEndpointOwnership(spy, 'a', ''), [])
  assert.deepEqual(await takeEndpointOwnership(spy, 'a', '   '), [])
  assert.equal(releaseCalls, 0, 'take non deve chiamare releaseOthers per endpoint null/vuoto')
  assert.equal(store.rows.get('a')?.endpoint, E)

  assert.equal(await maySendToEndpoint(spy, 'a', null), false)
  assert.equal(await maySendToEndpoint(spy, 'a', ''), false)
  assert.equal(await maySendToEndpoint(spy, 'a', '   '), false)
})

// ---------------------------------------------------------------------------
// C. Adattatore SQL: testo e parametri realmente passati al tag
// ---------------------------------------------------------------------------

type Recorded = { text: string; values: unknown[] }

function fakeSql(rows: unknown[]): { sql: SqlTag; calls: Recorded[] } {
  const calls: Recorded[] = []
  const tag = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]> => {
    calls.push({ text: strings.join('?'), values })
    return rows
  }
  return { sql: tag as unknown as SqlTag, calls }
}

const OWNER = 'owner@example.test'
const ENDPOINT = 'https://push.example.test/endpoint-E'

test("releaseOthers: UPDATE con NULL, espressione JSONB, lower(email) <> lower(?) e RETURNING email", async () => {
  const { sql, calls } = fakeSql([{ email: 'released@example.test' }])
  const ownership = sqlEndpointOwnership(sql)

  const released = await ownership.releaseOthers(OWNER, ENDPOINT)

  assert.deepEqual(released, ['released@example.test'])
  assert.equal(calls.length, 1)
  const [{ text, values }] = calls

  assert.match(text, /UPDATE marketing\.subscribers/)
  assert.match(text, /push_subscription = NULL/)
  assert.match(text, /btrim\(push_subscription->>'endpoint'\) = \?/)
  assert.match(text, /lower\(email\) <> lower\(\?\)/)
  assert.match(text, /RETURNING email/)

  assert.deepEqual(values, [ENDPOINT, OWNER])
  assert.equal(text.includes(OWNER), false, "l'email non deve essere interpolata nel testo")
  assert.equal(text.includes(ENDPOINT), false, "l'endpoint non deve essere interpolato nel testo")
})

test('otherOwners: SELECT filtrata, stessi due parametri e mappatura delle righe', async () => {
  const { sql, calls } = fakeSql([{ email: 'a@example.test' }, { email: 'b@example.test' }])
  const ownership = sqlEndpointOwnership(sql)

  const owners = await ownership.otherOwners(OWNER, ENDPOINT)

  assert.deepEqual(owners, ['a@example.test', 'b@example.test'])
  assert.equal(calls.length, 1)
  const [{ text, values }] = calls

  assert.match(text, /SELECT email FROM marketing\.subscribers/)
  assert.match(text, /push_subscription IS NOT NULL/)
  assert.match(text, /btrim\(push_subscription->>'endpoint'\) = \?/)
  assert.match(text, /lower\(email\) <> lower\(\?\)/)
  assert.doesNotMatch(text, /RETURNING email/)

  assert.deepEqual(values, [ENDPOINT, OWNER])
  assert.equal(text.includes(OWNER), false, "l'email non deve essere interpolata nel testo")
  assert.equal(text.includes(ENDPOINT), false, "l'endpoint non deve essere interpolato nel testo")
})

// ---------------------------------------------------------------------------
// D. Guardie sul cablaggio reale (i file spediti, non una copia)
// ---------------------------------------------------------------------------

/** Corpo fra `export async function <nome>` e il successivo `export `, spazi normalizzati. */
function exportedBody(source: string, name: string): string {
  const marker = `export async function ${name}`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `funzione ${name} non trovata`)
  const fromStart = source.slice(start)
  const nextExport = fromStart.indexOf('\nexport ', 1)
  const body = nextExport === -1 ? fromStart : fromStart.slice(0, nextExport)
  return body.replace(/\s+/g, ' ')
}

/**
 * La presa di proprieta' deve essere condizionata alle righe toccate dalla
 * UPDATE, sia con graffe (`if (...) { await ... }`) sia senza
 * (`if (...) await ...`). Senza la condizione sul risultato la guardia
 * fallisce: e' il comportamento che conta, non la forma.
 */
function assertTakeOwnershipGuarded(body: string): void {
  assert.match(body, /await takeEndpointOwnership\(/, "l'await su takeEndpointOwnership e' obbligatorio")
  assert.match(
    body,
    /if\s*\(\s*updated\.length\s*>\s*0\s*\)\s*(?:\{\s*)?await\s+takeEndpointOwnership\(/,
    'la presa di proprieta deve avvenire solo se la UPDATE ha restituito almeno una riga',
  )
}

test('savePushSubscription: UPDATE con RETURNING e takeEndpointOwnership solo se ha toccato righe', () => {
  const source = readFileSync(new URL('./account-db.ts', import.meta.url), 'utf8')
  const body = exportedBody(source, 'savePushSubscription')

  assert.match(body, /takeEndpointOwnership\(/)
  assert.match(body, /subscriptionEndpoint\(/)
  assert.match(body, /sqlEndpointOwnership\(/)
  assert.match(body, /await takeEndpointOwnership\(/, "l'await su takeEndpointOwnership e' obbligatorio")
  assert.match(body, /RETURNING email/)

  const updateAnchor = body.indexOf('UPDATE marketing.subscribers')
  const ownershipAnchor = body.indexOf('await takeEndpointOwnership(')
  assert.notEqual(updateAnchor, -1, 'UPDATE marketing.subscribers non trovata')
  assert.notEqual(ownershipAnchor, -1, 'await takeEndpointOwnership non trovato')
  assert.ok(
    ownershipAnchor > updateAnchor,
    'la presa di proprieta deve avvenire dopo la scrittura della sottoscrizione',
  )

  assertTakeOwnershipGuarded(body)
})

test('guardia takeEndpointOwnership: entrambe le forme verdi, condizione rimossa rossa', () => {
  const common = 'UPDATE marketing.subscribers RETURNING email '
  const call =
    'takeEndpointOwnership(sqlEndpointOwnership(sql), email, subscriptionEndpoint(subscription))'

  assertTakeOwnershipGuarded(`${common}if (updated.length > 0) { await ${call} }`)
  assertTakeOwnershipGuarded(`${common}if (updated.length > 0) await ${call}`)
  assert.throws(
    () => assertTakeOwnershipGuarded(`${common}await ${call}`),
    /la presa di proprieta deve avvenire solo se/,
  )
})

/** Tipi dei parametri estratti tollerando newline, spazi e virgola finale. */
function functionParamTypes(source: string, name: string): string[] {
  const match = new RegExp(
    `export\\s+async\\s+function\\s+${name}\\s*\\(([\\s\\S]*?)\\)\\s*:\\s*Promise<boolean>`,
  ).exec(source)
  assert.ok(match, `dichiarazione di ${name} non trovata`)
  return match[1]
    .split(',')
    .map((param) => param.replace(/\s+/g, ' ').trim())
    .filter((param) => param.length > 0)
}

test('la firma pubblica di sendPushToEmail resta (email: string, payload: PushPayload)', () => {
  const source = readFileSync(new URL('./push.ts', import.meta.url), 'utf8')

  assert.deepEqual(functionParamTypes(source, 'sendPushToEmail'), [
    'email: string',
    'payload: PushPayload',
  ])
})

test('sendPushToEmail chiama maySendToEndpoint prima di sendNotification', () => {
  const source = readFileSync(new URL('./push.ts', import.meta.url), 'utf8')
  const body = exportedBody(source, 'sendPushToEmail')

  const ownershipCheck = body.indexOf('maySendToEndpoint(')
  const send = body.indexOf('sendNotification')
  assert.notEqual(ownershipCheck, -1, 'maySendToEndpoint non cablato')
  assert.notEqual(send, -1, 'sendNotification non trovato')
  assert.ok(ownershipCheck < send, 'il controllo di proprieta deve precedere l\'invio')
})

test('drop di sendPushToEmail: SET push_subscription = NULL filtrato da WHERE email =', () => {
  const source = readFileSync(new URL('./push.ts', import.meta.url), 'utf8')
  const body = exportedBody(source, 'sendPushToEmail')

  const setAnchor = body.indexOf('SET push_subscription = NULL')
  assert.notEqual(setAnchor, -1, 'SET push_subscription = NULL non trovata')
  const whereAnchor = body.indexOf('WHERE email =', setAnchor)
  assert.notEqual(whereAnchor, -1, 'WHERE email = non trovato dopo SET push_subscription = NULL')
  assert.ok(
    whereAnchor > setAnchor,
    'la drop deve filtrare per email: senza WHERE azzererebbe tutte le sottoscrizioni',
  )
})

/**
 * Guardia di cablaggio: `markPushSequenceStep(` deve venire dopo
 * `sendPushToEmail(` ed essere governata da un `if (<guard>)` che la precede,
 * sia senza graffe (`if (ok) await mark(...)`) sia dentro un blocco ancora
 * aperto (`if (ok) { ... await mark(...) }`). `flat` ha gli spazi normalizzati.
 */
function assertMarkGuardedBySend(
  flat: string,
  sendAnchor: number,
  markAnchor: number,
  guardNames: string[],
): void {
  assert.notEqual(sendAnchor, -1, 'sendPushToEmail non trovata')
  assert.notEqual(markAnchor, -1, 'markPushSequenceStep non trovata')
  assert.ok(markAnchor > sendAnchor, 'markPushSequenceStep deve venire dopo sendPushToEmail')

  for (const name of guardNames) {
    const guard = new RegExp(`if\\s*\\(\\s*${name}\\s*\\)`, 'g')
    let last: RegExpExecArray | null = null
    let match: RegExpExecArray | null
    while ((match = guard.exec(flat)) !== null) {
      if (match.index < markAnchor) last = match
    }
    if (!last) continue

    const between = flat.slice(last.index + last[0].length, markAnchor)
    // Nessuna graffa di chiusura fra il test e la chiamata: o il ramo e'
    // senza graffe, oppure il blocco `{ ... }` e' ancora aperto.
    const unbraced = /^\s*(?:await\s+)?$/.test(between)
    const openBlock = /^\s*\{\s*[^{}]*$/.test(between)
    if (unbraced || openBlock) return
  }

  assert.fail(
    `markPushSequenceStep non e' governato da if (${guardNames.join('|')}): la chiamata e' incondizionata`,
  )
}

test("cron push-sequences: markPushSequenceStep solo se sendPushToEmail e' riuscito", () => {
  const source = readFileSync(
    new URL('../app/api/cron/push-sequences/route.ts', import.meta.url),
    'utf8',
  )
  const flat = source.replace(/\s+/g, ' ')

  const sendAnchor = flat.indexOf('sendPushToEmail(')
  const markAnchor = flat.indexOf('markPushSequenceStep(')
  assertMarkGuardedBySend(flat, sendAnchor, markAnchor, ['ok'])
})

test('push-subscribe: markPushSequenceStep preceduto dal risultato di sendPushToEmail', () => {
  const source = readFileSync(
    new URL('../app/api/account/push-subscribe/route.ts', import.meta.url),
    'utf8',
  )
  const flat = source.replace(/\s+/g, ' ')

  const sendAnchor = flat.indexOf('sendPushToEmail(')
  const markAnchor = flat.indexOf('markPushSequenceStep(')
  assertMarkGuardedBySend(flat, sendAnchor, markAnchor, ['ok'])
})

// ---------------------------------------------------------------------------
// E. deliverToEmail: la decisione D2 esercitata con dipendenze finte
// ---------------------------------------------------------------------------

const DELIVERY_EMAIL = 'owner@example.test'
const DELIVERY_ENDPOINT = 'https://push.example.test/delivery-endpoint'
const DELIVERY_SUBSCRIPTION = {
  endpoint: DELIVERY_ENDPOINT,
  keys: { p256dh: 'p256dh-test', auth: 'auth-test' },
}
const DELIVERY_PAYLOAD: PushPayload = { title: 'Ciao', body: 'Corpo', url: '/it/account' }

class FakeDelivery implements PushDelivery {
  maySendCalls: Array<{ email: string; endpoint: string | null }> = []
  sendCalls: Array<{ subscription: unknown; body: string }> = []
  dropCalls: string[] = []

  maySendResult: boolean | Error = true
  sendError: unknown = null
  dropError: unknown = null

  async maySend(email: string, endpoint: string | null): Promise<boolean> {
    this.maySendCalls.push({ email, endpoint })
    if (this.maySendResult instanceof Error) throw this.maySendResult
    return this.maySendResult
  }

  async send(subscription: unknown, body: string): Promise<void> {
    this.sendCalls.push({ subscription, body })
    if (this.sendError) throw this.sendError
  }

  async drop(email: string): Promise<void> {
    this.dropCalls.push(email)
    if (this.dropError) throw this.dropError
  }
}

test('D2: endpoint con un altro titolare -> send mai chiamata e false', async () => {
  const delivery = new FakeDelivery()
  delivery.maySendResult = false

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, false)
  assert.deepEqual(delivery.maySendCalls, [
    { email: DELIVERY_EMAIL, endpoint: DELIVERY_ENDPOINT },
  ])
  assert.equal(delivery.sendCalls.length, 0)
  assert.equal(delivery.dropCalls.length, 0)
})

test('titolare unico -> send esattamente una volta con JSON.stringify(payload) e true', async () => {
  const delivery = new FakeDelivery()

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, true)
  assert.equal(delivery.sendCalls.length, 1)
  assert.equal(delivery.sendCalls[0].subscription, DELIVERY_SUBSCRIPTION)
  assert.equal(delivery.sendCalls[0].body, JSON.stringify(DELIVERY_PAYLOAD))
  assert.equal(delivery.dropCalls.length, 0)
})

test('maySend che lancia -> true non ritornato, send mai chiamata, nessuna eccezione', async () => {
  const delivery = new FakeDelivery()
  delivery.maySendResult = new Error('DB transitorio')

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, false)
  assert.equal(delivery.sendCalls.length, 0)
  assert.equal(delivery.dropCalls.length, 0)
})

test('send con statusCode 410 -> drop(email) e false', async () => {
  const delivery = new FakeDelivery()
  delivery.sendError = Object.assign(new Error('Gone'), { statusCode: 410 })

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, false)
  assert.equal(delivery.sendCalls.length, 1)
  assert.deepEqual(delivery.dropCalls, [DELIVERY_EMAIL])
})

test('send con statusCode 404 -> drop(email) e false', async () => {
  const delivery = new FakeDelivery()
  delivery.sendError = Object.assign(new Error('Not Found'), { statusCode: 404 })

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, false)
  assert.deepEqual(delivery.dropCalls, [DELIVERY_EMAIL])
})

test('send senza statusCode -> false e drop mai chiamata', async () => {
  const delivery = new FakeDelivery()
  delivery.sendError = new Error('rete')

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, false)
  assert.equal(delivery.sendCalls.length, 1)
  assert.equal(delivery.dropCalls.length, 0)
})

test('drop che lancia -> false e nessuna eccezione', async () => {
  const delivery = new FakeDelivery()
  delivery.sendError = Object.assign(new Error('Gone'), { statusCode: 410 })
  delivery.dropError = new Error('cleanup fallito')

  const sent = await deliverToEmail(delivery, DELIVERY_EMAIL, DELIVERY_SUBSCRIPTION, DELIVERY_PAYLOAD)

  assert.equal(sent, false)
  assert.deepEqual(delivery.dropCalls, [DELIVERY_EMAIL])
})
