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

test('non-regressione invio: un record presente riceve il push dal provider', () => {
  const store = new Map([['a', { endpoint: 'https://push.example/a' }]])
  const outbox: Delivery[] = []
  const invia = provider(store, outbox)

  assert.equal(invia('a', 'ordine pronto'), true)
  assert.equal(outbox.length, 1)
  assert.equal(outbox[0]?.endpoint, 'https://push.example/a')
  assert.equal(outbox[0]?.payload, 'ordine pronto')
})

test("guardia sul contratto di sendPushToEmail: filtro per email e push_subscription non null", () => {
  const source = readFileSync(new URL('./push.ts', import.meta.url), 'utf8')
  assert.match(
    source,
    /WHERE email = \$\{email\} AND push_subscription IS NOT NULL/,
    'sendPushToEmail deve continuare a selezionare solo la sottoscrizione di quella email',
  )
})
