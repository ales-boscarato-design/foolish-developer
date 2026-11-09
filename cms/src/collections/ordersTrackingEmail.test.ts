import assert from 'node:assert/strict'
import test from 'node:test'
import type { Order } from '../payload-types'
import { Orders, sendTrackingEmail } from './Orders'

const STOREFRONT = 'https://storefront.test'
const RESEND_ENDPOINT = 'https://api.resend.com/emails'

type HookArgs = Parameters<typeof sendTrackingEmail>[0]

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: 1,
    orderNumber: 'FOOLISH-TEST-1',
    customerEmail: 'cliente@example.test',
    customerLocale: 'it',
    total: 100,
    lineItems: [],
    trackingNumber: 'TRACK-123',
    trackingCarrier: 'DHL',
    pageToken: 'token-abc',
    ...overrides,
  } as unknown as Order
}

function ctx(doc: Order): HookArgs {
  return {
    doc,
    previousDoc: { trackingNumber: null } as unknown as Order,
    operation: 'update',
  } as unknown as HookArgs
}

type RecordedCall = { url: string; body: string }

function stubFetch(respond: () => unknown) {
  const calls: RecordedCall[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    return respond()
  }) as unknown as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

function captureConsole() {
  const errors: string[] = []
  const logs: string[] = []
  const originalError = console.error
  const originalLog = console.log
  console.error = (...args: unknown[]) => {
    errors.push(args.map((a) => String(a)).join(' '))
  }
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '))
  }
  return {
    errors,
    logs,
    restore: () => {
      console.error = originalError
      console.log = originalLog
    },
  }
}

function withEnv() {
  const previous = { key: process.env.RESEND_API_KEY, url: process.env.STOREFRONT_URL }
  process.env.RESEND_API_KEY = 'test-key'
  process.env.STOREFRONT_URL = STOREFRONT
  return () => {
    if (previous.key === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = previous.key
    if (previous.url === undefined) delete process.env.STOREFRONT_URL
    else process.env.STOREFRONT_URL = previous.url
  }
}

test('pageToken presente: l\'email contiene il link di tracking corretto', async () => {
  const restoreEnv = withEnv()
  const stub = stubFetch(() => ({ ok: true, status: 200, text: async () => '' }))
  const out = captureConsole()
  try {
    await sendTrackingEmail(ctx(order()))

    assert.equal(stub.calls.length, 1, 'deve partire una sola email')
    assert.equal(stub.calls[0]!.url, RESEND_ENDPOINT)
    const payload = JSON.parse(stub.calls[0]!.body) as { to: string; html: string }
    assert.equal(payload.to, 'cliente@example.test')
    assert.match(payload.html, /https:\/\/storefront\.test\/ordine\/token-abc/)
    assert.equal(out.errors.length, 0, 'nessun errore atteso con token presente')
  } finally {
    out.restore()
    stub.restore()
    restoreEnv()
  }
})

test('pageToken assente: nessun link, nessun /ordine/null, anomalia loggata', async () => {
  const restoreEnv = withEnv()
  const stub = stubFetch(() => ({ ok: true, status: 200, text: async () => '' }))
  const out = captureConsole()
  try {
    await sendTrackingEmail(ctx(order({ pageToken: undefined as unknown as Order['pageToken'] })))

    assert.equal(stub.calls.length, 1, 'l\'email parte comunque: manca solo il link')
    const payload = JSON.parse(stub.calls[0]!.body) as { html: string }
    assert.equal(payload.html.includes('/ordine/'), false, 'nessun link di tracking senza token')
    assert.equal(payload.html.includes('null'), false, 'nessun /ordine/null nell\'HTML')
    assert.equal(payload.html.includes('undefined'), false, 'nessun /ordine/undefined nell\'HTML')
    assert.equal(out.errors.length, 1, 'l\'anomalia deve essere loggata')
    assert.match(out.errors[0]!, /pageToken/)
  } finally {
    out.restore()
    stub.restore()
    restoreEnv()
  }
})

for (const emptyToken of ['', '   ']) {
  test(`pageToken vuoto (${JSON.stringify(emptyToken)}): nessun link e anomalia loggata`, async () => {
    const restoreEnv = withEnv()
    const stub = stubFetch(() => ({ ok: true, status: 200, text: async () => '' }))
    const out = captureConsole()
    try {
      await sendTrackingEmail(ctx(order({ pageToken: emptyToken })))

      const payload = JSON.parse(stub.calls[0]!.body) as { html: string }
      assert.equal(payload.html.includes('/ordine/'), false)
      assert.equal(payload.html.includes('null'), false)
      assert.equal(out.errors.length, 1)
      assert.match(out.errors[0]!, /pageToken/)
    } finally {
      out.restore()
      stub.restore()
      restoreEnv()
    }
  })
}

test('Resend 500: logga status e corpo, non lancia', async () => {
  const restoreEnv = withEnv()
  const stub = stubFetch(() => ({ ok: false, status: 500, text: async () => 'errore-simulato' }))
  const out = captureConsole()
  try {
    await assert.doesNotReject(() => sendTrackingEmail(ctx(order())))

    const logged = out.errors.join('\n')
    assert.match(logged, /500/, 'lo status deve finire nei log')
    assert.match(logged, /errore-simulato/, 'il corpo della risposta deve finire nei log')
  } finally {
    out.restore()
    stub.restore()
    restoreEnv()
  }
})

test('errore di rete: l\'hook non lancia e logga', async () => {
  const restoreEnv = withEnv()
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error('rete-non-raggiungibile')
  }) as unknown as typeof fetch
  const out = captureConsole()
  try {
    await assert.doesNotReject(() => sendTrackingEmail(ctx(order())))
    assert.match(out.errors.join('\n'), /rete-non-raggiungibile/)
  } finally {
    out.restore()
    globalThis.fetch = original
    restoreEnv()
  }
})

test('sendTrackingEmail è agganciato agli hook afterChange di Orders', () => {
  const hooks = Orders.hooks?.afterChange ?? []
  assert.ok(hooks.includes(sendTrackingEmail), 'l\'hook deve restare registrato nella collection')
})
