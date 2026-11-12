import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import https from 'node:https'
import { EventEmitter } from 'node:events'
import { NextRequest } from 'next/server'

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

test('checkout senza attribution non aggiunge il metadata', async () => {
  const beforeCount = stripeBodies.length
  const { POST } = await import('./route')
  const response = await POST(request())
  assert.equal(response.status, 200)
  assert.equal(stripeBodies.length, beforeCount + 1)
  assert.equal(new URLSearchParams(stripeBodies.at(-1)).has('metadata[attribution_json]'), false)
})
