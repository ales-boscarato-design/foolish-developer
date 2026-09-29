import assert from 'node:assert/strict'
import test from 'node:test'
import type { CollectionAfterChangeHook } from 'payload'
import { Orders } from './Orders'

type TestOrder = {
  id: string
  orderNumber: string
  trackingNumber: string
  trackingCarrier: string
  customerEmail: string
  customerLocale: string
  pageToken?: string | null
}

type FetchCall = Parameters<typeof fetch>

const trackingHook: CollectionAfterChangeHook = Orders.hooks?.afterChange?.at(-1) ?? (() => {
  throw new Error('Orders tracking hook is not registered')
})

function makeOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  return {
    id: 'order-id-42',
    orderNumber: 'ORD-42',
    trackingNumber: 'TRACK-42',
    trackingCarrier: 'DHL',
    customerEmail: 'alice@example.com',
    customerLocale: 'en',
    pageToken: 'page-token-42',
    ...overrides,
  }
}

function logText(entries: unknown[][]): string {
  return entries
    .map((args) => args.map((arg) => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' '))
    .join('\n')
}

async function runTrackingHook(options: {
  response?: Response
  doc?: TestOrder
  previousDoc?: TestOrder
  fetchImplementation?: typeof fetch
}) {
  const calls: FetchCall[] = []
  const logs: unknown[][] = []
  const errors: unknown[][] = []
  const originalFetch = globalThis.fetch
  const originalLog = console.log
  const originalError = console.error
  const originalEnvironment = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    RESEND_FROM: process.env.RESEND_FROM,
    STOREFRONT_URL: process.env.STOREFRONT_URL,
  }

  process.env.RESEND_API_KEY = 'test-resend-key'
  process.env.RESEND_FROM = 'The Foolish Butcher <test@example.com>'
  process.env.STOREFRONT_URL = 'https://shop.test'
  console.log = (...args: unknown[]) => logs.push(args)
  console.error = (...args: unknown[]) => errors.push(args)
  globalThis.fetch = options.fetchImplementation ?? (async (...args: Parameters<typeof fetch>) => {
    calls.push(args)
    return options.response ?? new Response(null, { status: 204 })
  })

  try {
    await trackingHook({
      doc: (options.doc ?? makeOrder()) as never,
      previousDoc: options.previousDoc as never,
      operation: 'update',
    } as unknown as Parameters<CollectionAfterChangeHook>[0])
    return { calls, logs, errors }
  } finally {
    globalThis.fetch = originalFetch
    console.log = originalLog
    console.error = originalError
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('tracking email logs non-2xx status and a bounded sanitized provider reason', async () => {
  const result = await runTrackingHook({
    response: new Response(JSON.stringify({
      message: 'sender rejected\ncontact alice@example.com with Bearer sk_test_secret',
    }), { status: 422, headers: { 'content-type': 'application/json' } }),
  })

  const output = logText(result.errors)
  assert.equal(result.calls.length, 1)
  assert.match(output, /Tracking email failed/)
  assert.match(output, /"status":422/)
  assert.match(output, /sender rejected/)
  assert.doesNotMatch(output, /alice@example\.com/)
  assert.doesNotMatch(output, /sk_test_secret/)
})

test('tracking email logs a successful outcome with masked recipient and order identifier', async () => {
  const result = await runTrackingHook({
    response: new Response(null, { status: 202 }),
  })

  const output = logText(result.logs)
  assert.equal(result.calls.length, 1)
  assert.match(output, /Tracking email sent/)
  assert.match(output, /"outcome":"sent"/)
  assert.match(output, /"order":"ORD-42"/)
  assert.match(output, /a\*\*\*@e\*\*\*\.com/)
  assert.doesNotMatch(output, /alice@example\.com/)
})

test('tracking email omits the tracking link when pageToken is missing', async () => {
  const result = await runTrackingHook({
    doc: makeOrder({ pageToken: null }),
    response: new Response(null, { status: 200 }),
  })

  assert.equal(result.calls.length, 1)
  const requestBody = JSON.parse(String(result.calls[0]?.[1]?.body)) as { html: string }
  assert.match(requestBody.html, /TRACK-42/)
  assert.doesNotMatch(requestBody.html, /\/ordine\/null/)
  assert.doesNotMatch(requestBody.html, /href="https:\/\/shop\.test\/ordine\//)
})

test('tracking email preserves no-duplicate behavior for unchanged tracking', async () => {
  const result = await runTrackingHook({
    doc: makeOrder({ trackingNumber: 'TRACK-UNCHANGED' }),
    previousDoc: makeOrder({ trackingNumber: 'TRACK-UNCHANGED' }),
    fetchImplementation: async () => {
      throw new Error('fetch should not be called for unchanged tracking')
    },
  })

  assert.equal(result.calls.length, 0)
  assert.equal(result.logs.length, 0)
  assert.equal(result.errors.length, 0)
})
