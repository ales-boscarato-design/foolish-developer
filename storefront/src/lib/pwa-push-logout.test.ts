import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { performLogout } from './logout-session'
import { unsubscribePushOnLogout, type PushManagerLike } from './push-logout'

interface PushRecord {
  endpoint: string
}

interface Delivery {
  endpoint: string
  payload: string
}

/**
 * Provider push simulato: replica `sendPushToEmail`, che invia solo se lo store
 * contiene una riga per quell'email con `push_subscription` non nullo.
 */
function provider(store: Map<string, PushRecord>, outbox: Delivery[]) {
  return (email: string, payload: string): boolean => {
    const record = store.get(email)
    if (!record) return false
    outbox.push({ endpoint: record.endpoint, payload })
    return true
  }
}

/** Replica il contratto SQL di `clearPushSubscription`: azzera solo la riga dell'email. */
function clearPushSubscriptionFrom(store: Map<string, PushRecord>) {
  return async (email: string): Promise<void> => {
    if (store.has(email)) store.delete(email)
  }
}

/** Le guardie sui sorgenti non devono dipendere dalla formattazione. */
function normalizeSource(source: string): string {
  return source.replace(/\s+/g, ' ')
}

/** Estrae il testo fra due marcatori, cosi' le asserzioni restano locali alla funzione. */
function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `marcatore di inizio non trovato: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `marcatore di fine non trovato: ${endMarker}`)
  return source.slice(start, end)
}

/** Ritaglia il corpo di una `export async function` fino al successivo export:
 *  il criterio non dipende dall'ordine delle funzioni nel file. */
function exportFunctionBody(source: string, name: string): string {
  const startMarker = `export async function ${name}`
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `funzione non trovata: ${name}`)
  const end = source.indexOf('\nexport ', start + startMarker.length)
  assert.notEqual(end, -1, `export successivo non trovato dopo: ${name}`)
  return source.slice(start, end)
}

test('due utenti sullo stesso dispositivo: il logout azzera browser e server', async () => {
  // Un solo slot per origine, come il browser: la sottoscrizione non e' per sessione.
  let slot: PushRecord | null = null
  const store = new Map<string, PushRecord>()
  const outbox: Delivery[] = []
  const invia = provider(store, outbox)
  let sessione: string | null = 'a'

  const getPushManager = async (): Promise<PushManagerLike | null> => ({
    async getSubscription() {
      if (!slot) return null
      const endpoint = slot.endpoint
      return {
        async unsubscribe() {
          if (slot?.endpoint !== endpoint) return false
          slot = null
          return true
        },
      }
    },
  })

  // (1) A abilita le notifiche: slot del browser e record server puntano allo stesso endpoint.
  slot = { endpoint: 'https://push.example/a' }
  store.set('a', { endpoint: 'https://push.example/a' })
  assert.equal(invia('a', 'benvenuta A'), true)
  assert.equal(outbox.length, 1)
  assert.equal(outbox[0]?.endpoint, 'https://push.example/a')

  // (2) Logout: il server azzera il record di A e cancella il cookie di sessione.
  const outboxPrimaDelLogout = outbox.length
  const result = await performLogout({
    getSession: async () => (sessione ? { email: sessione } : null),
    clearPushSubscription: clearPushSubscriptionFrom(store),
    deleteSessionCookie: async () => { sessione = null },
  })
  assert.deepEqual(result, { ok: true, pushClearedFor: 'a', pushClearFailed: false })
  assert.equal(store.has('a'), false)
  assert.equal(sessione, null)

  // (3) Il client disiscrive il browser: lo slot dell'origine resta vuoto.
  assert.equal(await unsubscribePushOnLogout({ getPushManager }), 'unsubscribed')
  assert.equal(slot, null)

  // (4) Login di B: B non ha un endpoint sul server e A non riceve piu' nulla.
  sessione = 'b'
  assert.equal(invia('b', 'benvenuto B'), false)
  assert.equal(invia('a', 'dati personali di A'), false)
  assert.equal(outbox.length, outboxPrimaDelLogout)
  assert.equal(
    outbox.slice(outboxPrimaDelLogout).some((delivery) => delivery.endpoint === 'https://push.example/a'),
    false,
    "dopo il logout nessun payload puo' essere consegnato all'endpoint di A",
  )
})

test('nessun service worker: unsubscribe e unsupported e il server azzera comunque il cookie', async () => {
  let cookie: string | null = 'a'
  const store = new Map([['a', { endpoint: 'https://push.example/a' }]])

  const result = await performLogout({
    getSession: async () => ({ email: 'a' }),
    clearPushSubscription: clearPushSubscriptionFrom(store),
    deleteSessionCookie: async () => { cookie = null },
  })

  assert.deepEqual(result, { ok: true, pushClearedFor: 'a', pushClearFailed: false })
  assert.equal(cookie, null)
  assert.equal(store.has('a'), false)
  assert.equal(await unsubscribePushOnLogout({ getPushManager: async () => null }), 'unsupported')
})

test('un lookup o un unsubscribe che lancia diventa failed, senza propagare', async () => {
  const lookup = await unsubscribePushOnLogout({
    getPushManager: async () => { throw new Error('lookup rotto') },
  })
  assert.equal(lookup, 'failed')

  const subscriptionRead = await unsubscribePushOnLogout({
    getPushManager: async () => ({
      getSubscription: async () => { throw new Error('getSubscription rotto') },
    }),
  })
  assert.equal(subscriptionRead, 'failed')

  const unsubscribe = await unsubscribePushOnLogout({
    getPushManager: async () => ({
      getSubscription: async () => ({
        unsubscribe: async () => { throw new Error('unsubscribe rotto') },
      }),
    }),
  })
  assert.equal(unsubscribe, 'failed')
})

test('nessuna sottoscrizione o unsubscribe rifiutato: none e failed senza eccezioni', async () => {
  assert.equal(
    await unsubscribePushOnLogout({
      getPushManager: async () => ({ getSubscription: async () => null }),
    }),
    'none',
  )
  assert.equal(
    await unsubscribePushOnLogout({
      getPushManager: async () => ({
        getSubscription: async () => ({ unsubscribe: () => false }),
      }),
    }),
    'failed',
  )
})

test("se l'azzeramento server fallisce il cookie viene cancellato lo stesso", async () => {
  let cookie: string | null = 'a'
  const failure = new Error('db giu')
  const seen: unknown[] = []

  const result = await performLogout({
    getSession: async () => ({ email: 'a' }),
    clearPushSubscription: async () => { throw failure },
    deleteSessionCookie: async () => { cookie = null },
    onError: (err) => { seen.push(err) },
  })

  assert.deepEqual(result, { ok: true, pushClearedFor: null, pushClearFailed: true })
  assert.equal(cookie, null)
  assert.equal(seen.length, 1)
  assert.equal(seen[0], failure)
})

test('azzeramento mirato: esce A e resta solo B', async () => {
  const store = new Map<string, PushRecord>([
    ['a', { endpoint: 'https://push.example/a' }],
    ['b', { endpoint: 'https://push.example/b' }],
  ])
  let cookie: string | null = 'a'

  const result = await performLogout({
    getSession: async () => ({ email: 'a' }),
    clearPushSubscription: clearPushSubscriptionFrom(store),
    deleteSessionCookie: async () => { cookie = null },
  })

  assert.equal(result.pushClearedFor, 'a')
  assert.equal(store.has('a'), false)
  assert.deepEqual(store.get('b'), { endpoint: 'https://push.example/b' })
  assert.equal(cookie, null)
})

test('sessione illeggibile: cookie cancellato, errore riportato, nessuna email usata', async () => {
  let cookie: string | null = 'a'
  const failure = new Error('sessione rotta')
  const seen: unknown[] = []
  const pushCalls: string[] = []

  const result = await performLogout({
    getSession: async () => { throw failure },
    clearPushSubscription: async (email) => { pushCalls.push(email) },
    deleteSessionCookie: async () => { cookie = null },
    onError: (err) => { seen.push(err) },
  })

  assert.deepEqual(result, { ok: true, pushClearedFor: null, pushClearFailed: false })
  assert.equal(cookie, null)
  assert.equal(seen.length, 1)
  assert.equal(seen[0], failure)
  assert.deepEqual(pushCalls, [])
})

test('se la cancellazione del cookie fallisce il push viene azzerato lo stesso e onError riporta', async () => {
  const failure = new Error('cookie rotto')
  const seen: unknown[] = []
  const pushCalls: string[] = []

  const result = await performLogout({
    getSession: async () => ({ email: 'a' }),
    clearPushSubscription: async (email) => { pushCalls.push(email) },
    deleteSessionCookie: async () => { throw failure },
    onError: (err) => { seen.push(err) },
  })

  // performLogout non rigetta e prosegue con l'azzeramento push.
  assert.deepEqual(result, { ok: true, pushClearedFor: 'a', pushClearFailed: false })
  assert.deepEqual(pushCalls, ['a'])
  assert.equal(seen.length, 1)
  assert.equal(seen[0], failure)
})

test('sessione con email vuota o di soli spazi: nessun azzeramento push e nessun errore', async () => {
  const pushCalls: string[] = []
  const seen: unknown[] = []

  for (const email of ['', '   ']) {
    const result = await performLogout({
      getSession: async () => ({ email }),
      clearPushSubscription: async (value) => { pushCalls.push(value) },
      deleteSessionCookie: async () => {},
      onError: (err) => { seen.push(err) },
    })
    assert.deepEqual(result, { ok: true, pushClearedFor: null, pushClearFailed: false })
  }

  assert.deepEqual(pushCalls, [])
  assert.deepEqual(seen, [])
})

test('il cookie muore prima dell azzeramento push', async () => {
  const events: string[] = []

  const result = await performLogout({
    getSession: async () => {
      events.push('session')
      return { email: 'a' }
    },
    deleteSessionCookie: async () => { events.push('cookie') },
    clearPushSubscription: async () => { events.push('push') },
  })

  assert.deepEqual(events, ['session', 'cookie', 'push'])
  assert.deepEqual(result, { ok: true, pushClearedFor: 'a', pushClearFailed: false })
})

test("guardia sul contratto di account-db: iscrizione e azzeramento restano filtrati per email", () => {
  const source = readFileSync(new URL('./account-db.ts', import.meta.url), 'utf8')

  const saveBody = normalizeSource(exportFunctionBody(source, 'savePushSubscription'))
  assert.match(
    saveBody,
    /push_subscription\s*=\s*\$\{JSON\.stringify\(subscription\)\}\s*::jsonb/,
    'savePushSubscription deve continuare a scrivere la sottoscrizione JSON',
  )

  const clearBody = normalizeSource(exportFunctionBody(source, 'clearPushSubscription'))
  assert.match(
    clearBody,
    /SET push_subscription = NULL/,
    'clearPushSubscription deve azzerare la sottoscrizione',
  )
  assert.match(
    clearBody,
    /WHERE email = \$\{email\}/,
    'clearPushSubscription deve continuare a filtrare per email',
  )
})

test("guardia sul contratto di sendPushToEmail: filtro per email e push_subscription non null", () => {
  const source = normalizeSource(readFileSync(new URL('./push.ts', import.meta.url), 'utf8'))
  assert.match(
    source,
    /WHERE email = \$\{email\} AND push_subscription IS NOT NULL/,
    'sendPushToEmail deve continuare a selezionare solo la sottoscrizione di quella email',
  )
})

/**
 * R1 — la suite morde le librerie, queste asserzioni legano le librerie alle
 * entry point reali: senza, togliere la chiamata lascia tutto verde. Le guardie
 * ignorano la formattazione (spazi, a capo, apici) ma non il comportamento:
 * R1b in particolare non e' fail-open, il delete del cookie e' obbligatorio.
 */
test('R1a: ProfileForm disiscrive il browser prima della POST di logout', () => {
  const source = normalizeSource(
    readFileSync(
      new URL(
        '../app/(customer-app)/account/(protected)/profilo/_components/ProfileForm.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const logoutBody = sourceBetween(source, 'async function logout()', 'router.push')
  const unsubscribeIndex = logoutBody.search(/unsubscribePushOnLogout\s*\(/)
  const fetchIndex = logoutBody.search(/fetch\s*\(\s*['"]\/api\/account\/logout/)

  assert.notEqual(unsubscribeIndex, -1, 'logout() deve disiscrivere il browser')
  assert.notEqual(fetchIndex, -1, "logout() deve chiamare fetch('/api/account/logout')")
  assert.ok(
    unsubscribeIndex < fetchIndex,
    "unsubscribePushOnLogout() deve avvenire prima di fetch('/api/account/logout')",
  )
})

test('R1b: la route di logout passa da performLogout e azzera il push', () => {
  const source = normalizeSource(
    readFileSync(new URL('../app/api/account/logout/route.ts', import.meta.url), 'utf8'),
  )
  const start = source.indexOf('export async function POST')
  assert.notEqual(start, -1, 'la route deve esportare POST')
  const postBody = source.slice(start)

  assert.match(postBody, /performLogout\(/, 'la POST deve usare performLogout')
  assert.match(
    postBody,
    /clearPushSubscription,/,
    'performLogout deve ricevere clearPushSubscription',
  )
  assert.match(postBody, /getSession,/, 'performLogout deve ricevere getSession')
  assert.match(
    postBody,
    /deleteSessionCookie:/,
    'performLogout deve ricevere deleteSessionCookie',
  )

  // Il delete del cookie e' obbligatorio e deve stare nella lambda passata a
  // performLogout: senza questa asserzione `deleteSessionCookie: async () => {}`
  // lascerebbe la suite verde (fail-open).
  const deleteIndex = postBody.search(/\.delete\(\s*SESSION_COOKIE\.name\s*\)/)
  assert.notEqual(deleteIndex, -1, 'la POST deve cancellare il cookie di sessione')
  const deleteSessionCookieIndex = postBody.indexOf('deleteSessionCookie:')
  const onErrorIndex = postBody.indexOf('onError:')
  assert.notEqual(deleteSessionCookieIndex, -1, 'performLogout deve ricevere deleteSessionCookie')
  assert.notEqual(onErrorIndex, -1, 'la POST deve passare onError a performLogout')
  assert.ok(
    deleteIndex > deleteSessionCookieIndex && deleteIndex < onErrorIndex,
    'il delete del cookie deve stare nella lambda deleteSessionCookie passata a performLogout',
  )
})
