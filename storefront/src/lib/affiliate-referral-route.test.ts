import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { NextRequest } from 'next/server'

const STOREFRONT_SECRET = 'test-storefront-secret'
process.env.PAYLOAD_API_SECRET = STOREFRONT_SECRET

import { GET } from '../app/[locale]/a/[slug]/route'

/**
 * Route-level test of the referral link.
 *
 * Why it exists: the redirect target must NEVER carry an origin. Behind a proxy
 * the runtime sees the internal bind address as its own origin, so a Location
 * built from the request becomes https://0.0.0.0:8080/it and the visitor lands
 * on a dead address. That defect was invisible to every lib-level test and to a
 * local end-to-end check, where the origin happened to be correct: only the
 * response of the real route under a proxied origin exposes it.
 */

let server: ReturnType<typeof createServer>
let baseUrl = ''

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const authorized = req.headers['x-storefront-secret'] === STOREFRONT_SECRET
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (!authorized) return json(401, { error: 'unauthorized' })

    if (url.pathname === '/api/affiliates') {
      const slug = url.searchParams.get('where[slug][equals]')
      if (slug !== 'nestor') return json(200, { docs: [] })
      return json(200, {
        docs: [{
          id: 1,
          slug: 'nestor',
          status: 'active',
          promoCode: 12,
          commissionBaseRateBps: 1500,
          commissionStepRateBps: 300,
          commissionStepThresholdCents: 50000,
          commissionMaxRateBps: 3800,
          cookieWindowDays: 30,
        }],
      })
    }
    if (url.pathname === '/api/promo-codes') {
      return json(200, { docs: [{ id: 12, code: 'NESTOR15', type: 'percent', active: true }] })
    }
    return json(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  baseUrl = `http://127.0.0.1:${address.port}`
  process.env.PAYLOAD_PUBLIC_URL = baseUrl
})

after(() => { server.close() })

/** A request as the runtime sees it in production: proxied origin, internal host. */
function proxiedRequest(path: string): NextRequest {
  return new NextRequest(new Request(`http://0.0.0.0:8080${path}`, { headers: { host: '0.0.0.0:8080' } }))
}

async function callRoute(path: string, slug = 'nestor') {
  const response = await GET(proxiedRequest(path), {
    params: Promise.resolve({ locale: 'it', slug }),
  })
  return {
    status: response.status,
    location: response.headers.get('location'),
    cookie: response.headers.get('set-cookie'),
  }
}

test('the redirect target is relative even when the origin is the internal proxy address', async () => {
  const result = await callRoute('/it/a/nestor')

  assert.equal(result.status, 302)
  assert.equal(result.location, '/it')
  // The three ways this could regress into an unreachable or hostile target.
  assert.ok(!String(result.location).startsWith('http'), 'Location must not be absolute')
  assert.ok(!String(result.location).includes('0.0.0.0'), 'Location must not carry the internal host')
  assert.ok(String(result.location).startsWith('/'), 'Location must be a rooted path')
})

test('the successful referral writes the affiliate cookie', async () => {
  const result = await callRoute('/it/a/nestor')

  assert.match(String(result.cookie), /foolish_ref=nestor/)
  assert.match(String(result.cookie), /HttpOnly/)
  assert.match(String(result.cookie), /SameSite=lax/)
})

test('an unknown affiliate redirects relatively and sets no referral cookie', async () => {
  const result = await callRoute('/it/a/sconosciuto', 'sconosciuto')

  assert.equal(result.status, 302)
  assert.equal(result.location, '/it')
  assert.ok(!String(result.cookie).includes('foolish_ref'), 'no referral cookie for an unknown slug')
})

test('an internal ?to= target stays relative and keeps query and hash', async () => {
  const result = await callRoute('/it/a/nestor?to=%2Fprodotti%3Fcolore%3Dnero%23top')

  assert.equal(result.location, '/prodotti?colore=nero#top')
})

test('an escaping ?to= target falls back to the locale home, still relative', async () => {
  const result = await callRoute('/it/a/nestor?to=%2F%2Fevil.com')

  assert.equal(result.location, '/it')
  assert.ok(!String(result.location).includes('evil.com'))
})
