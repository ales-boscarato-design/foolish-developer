import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { NextRequest } from 'next/server'
import { captureAttribution, readAttribution } from '@/lib/attribution-client'

process.env.STRIPE_SECRET_KEY = 'sk_test_local_only'
process.env.PAYLOAD_API_SECRET = 'test-storefront-secret'
process.env.STOREFRONT_URL = 'https://shop.test'
const stripeBodies: string[] = []
const originalStripeRequest = https.request

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  res.setHeader('content-type', 'application/json')
  if (url.pathname === '/api/orders' && req.method === 'GET' && req.headers['x-storefront-secret'] !== 'test-storefront-secret') {
    res.writeHead(401).end('{}')
    return
  }
  if (req.method === 'GET') {
    if (url.pathname === '/api/products') {
      res.writeHead(200).end(JSON.stringify({ docs: [{ id: 1, name: 'Synthetic Skin', active: true, variants: [{ sku: 'TEST-SKU', label: 'A4', price: 10, stockStatus: 'available' }] }] }))
      return
    }
    res.writeHead(200).end(JSON.stringify({ docs: [], totalDocs: 0 }))
    return
  }
  res.writeHead(200).end('{}')
})

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.env.PAYLOAD_PUBLIC_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
after(async () => {
  https.request = originalStripeRequest
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function request(attribution?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/stripe/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ sku: 'TEST-SKU', quantity: 1 }],
      customer: { email: 'buyer@example.com', firstName: 'Buyer', lastName: 'Test', name: 'Buyer Test', country: 'IT', address: 'Via Uno', city: 'Torino', postalCode: '10100' },
      ...(attribution === undefined ? {} : { attribution }),
    }),
  })
}

test('POST checkout scrive metadata attribution Stripe e non porta la sorgente nel PaymentIntent', async () => {
  stripeBodies.length = 0
  ;(https as unknown as { request: () => unknown }).request = () => {
    const req = new EventEmitter() as EventEmitter & { write: (chunk: string) => void; end: () => void; setTimeout: () => void; destroy: () => void }
    const chunks: string[] = []
    req.write = (chunk) => { chunks.push(String(chunk)) }
    req.setTimeout = () => req
    req.destroy = () => undefined
    req.end = () => {
      stripeBodies.push(chunks.join(''))
      const response = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string>; setEncoding: (encoding: string) => void }
      response.statusCode = 200
      response.headers = { 'content-type': 'application/json' }
      response.setEncoding = () => undefined
      queueMicrotask(() => {
        req.emit('response', response)
        queueMicrotask(() => {
          response.emit('data', JSON.stringify({ id: 'cs_test', object: 'checkout.session', url: 'https://checkout.stripe.test/x' }))
          response.emit('end')
        })
      })
    }
    queueMicrotask(() => req.emit('socket', { connecting: false }))
    return req
  }
  const { POST } = await import('./route')
  const response = await POST(request({ landingPath: '/it/', referrerHost: null, utmSource: 'google', utmMedium: 'cpc' }))
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  assert.deepEqual(await response.json(), { checkoutUrl: 'https://checkout.stripe.test/x' })
  const form = new URLSearchParams(stripeBodies[0])
  const encoded = form.get('metadata[attribution_json]')
  assert.ok(encoded)
  assert.equal(JSON.parse(encoded).sourceClass, 'paidAds')
  assert.equal(form.has('payment_intent_data[metadata][attribution_json]'), false)
})

test('checkout accetta attribuzione malformata senza conservarne i valori', async () => {
  const beforeCount = stripeBodies.length
  const { POST } = await import('./route')
  const response = await POST(request({ landingPath: 'javascript:alert(1)', utmSource: 'x'.repeat(101), sourceClass: 'hacked' }))
  assert.equal(response.status, 200)
  assert.ok((await response.json() as { checkoutUrl?: string }).checkoutUrl)
  assert.equal(stripeBodies.length, beforeCount + 1)
  assert.equal(new URLSearchParams(stripeBodies.at(-1)).has('metadata[attribution_json]'), false)
})

test('checkout invia a Stripe solo attribution anonima nonostante payload tampered e sovradimensionato', async () => {
  const beforeCount = stripeBodies.length
  const { POST } = await import('./route')
  const response = await POST(request({
    landingPath: '/it/pro/card/PRO-CODE-123', refSlug: 'buyer-private-slug',
    referrerHost: 'https://evil.example/path?email=buyer@example.com',
    utmSource: 'google', utmMedium: 'cpc',
    utmCampaign: `https://evil.example/?email=${'x'.repeat(2000)}`,
    utmTerm: 'PRO-CODE-123', utmContent: 'javascript:alert(1)',
    padding: 'x'.repeat(100_000),
  }))
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  assert.equal(stripeBodies.length, beforeCount + 1, 'attribution eccessiva non deve bloccare la sessione')
  const form = new URLSearchParams(stripeBodies.at(-1))
  const raw = form.get('metadata[attribution_json]')
  assert.ok(raw)
  assert.ok(raw.length <= 480)
  assert.deepEqual(JSON.parse(raw), {
    landingPath: null, referrerHost: null, utmSource: 'google', utmMedium: 'cpc',
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'unknown',
  })
  assert.equal(raw.includes('PRO-CODE-123'), false)
  assert.equal(raw.includes('buyer@example.com'), false)
  assert.equal(form.has('payment_intent_data[metadata][attribution_json]'), false)
})

test('checkout distingue direct dimostrato da referrer o utmSource scartati nei metadata Stripe', async () => {
  const { POST } = await import('./route')
  for (const [input, expectedClass] of [
    [{ landingPath: '/it/', referrerHost: null, utmSource: null, utmMedium: null, utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'direct' }, 'direct'],
    [{ landingPath: '/it/', referrerHost: 'https://customer.example/private' }, 'unknown'],
    [{ landingPath: '/it/', utmSource: 'buyer@example.com' }, 'unknown'],
  ] as const) {
    const response = await POST(request(input))
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
    const form = new URLSearchParams(stripeBodies.at(-1))
    const raw = form.get('metadata[attribution_json]')
    assert.ok(raw)
    const metadata = JSON.parse(raw) as Record<string, unknown>
    assert.equal(metadata.sourceClass, expectedClass)
    assert.equal(raw.includes('customer.example'), false)
    assert.equal(raw.includes('buyer@example.com'), false)
  }
})

test('checkout non promuove payload mancanti o malformati a direct', async () => {
  const { POST } = await import('./route')
  for (const input of [{}, { sourceClass: 'garbage' }]) {
    const beforeCount = stripeBodies.length
    const response = await POST(request(input))
    assert.equal(response.status, 200)
    assert.equal(stripeBodies.length, beforeCount + 1)
    assert.equal(new URLSearchParams(stripeBodies.at(-1)).has('metadata[attribution_json]'), false)
  }
})

test('storage malformato resta unknown; uno snapshot direct completo sopravvive senza path privato', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let raw = '{}'
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage: { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value } } },
  })
  try {
    for (const malformed of ['{}', '{"sourceClass":"garbage"}']) {
      raw = malformed
      captureAttribution()
      assert.equal(readAttribution()?.sourceClass, 'unknown')
    }
    raw = JSON.stringify({
      landingPath: null, referrerHost: null, utmSource: null, utmMedium: null,
      utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'direct',
    })
    const direct = readAttribution()
    assert.equal(direct?.sourceClass, 'direct')
    assert.equal(direct?.landingPath, null)
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('capture -> checkout metadata conserva unknown sui segnali misti e direct/organic autentici', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const storage = new Map<string, string>()
  const scenarios = [
    { href: 'https://shop.test/it/?utm_source=bing&utm_medium=email', referrer: '', expected: 'unknown' },
    { href: 'https://shop.test/it/?utm_medium=newsletter', referrer: 'https://www.google.com/search?q=private', expected: 'unknown' },
    { href: 'https://shop.test/it/', referrer: '', expected: 'direct' },
    { href: 'https://shop.test/it/prodotto/example', referrer: '', expected: 'direct' },
    { href: 'https://shop.test/it/', referrer: 'https://www.google.com/search?q=private', expected: 'organicSearch' },
  ] as const
  try {
    for (const scenario of scenarios) {
      storage.clear()
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: {
          location: { href: scenario.href },
          sessionStorage: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
          },
        },
      })
      Object.defineProperty(globalThis, 'document', { configurable: true, value: { referrer: scenario.referrer } })
      captureAttribution()
      const captured = readAttribution()
      assert.ok(captured)
      assert.equal(captured.sourceClass, scenario.expected)
      const response = await (await import('./route')).POST(request(captured))
      assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
      const form = new URLSearchParams(stripeBodies.at(-1))
      const raw = form.get('metadata[attribution_json]')
      assert.ok(raw)
      assert.equal((JSON.parse(raw) as Record<string, unknown>).sourceClass, scenario.expected)
      assert.equal(raw.includes('private'), false)
      if (scenario.href.includes('/prodotto/')) {
        const snapshot = JSON.parse(raw) as Record<string, unknown>
        assert.equal(snapshot.landingPath, null)
        assert.equal(raw.includes('/it/prodotto/example'), false)
        assert.ok(raw.length <= 480)
      }
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('checkout senza attribution non aggiunge il metadata', async () => {
  const beforeCount = stripeBodies.length
  const { POST } = await import('./route')
  const response = await POST(request())
  assert.equal(response.status, 200)
  assert.equal(stripeBodies.length, beforeCount + 1)
  assert.equal(new URLSearchParams(stripeBodies.at(-1)).has('metadata[attribution_json]'), false)
})
