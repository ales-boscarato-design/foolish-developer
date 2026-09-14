import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, before, test } from 'node:test'
import { NextRequest } from 'next/server'

const STOREFRONT_SECRET = 'test-storefront-secret'
process.env.PAYLOAD_API_SECRET = STOREFRONT_SECRET

import { GET } from '../app/[locale]/a/[slug]/route'
import { preferredLocale } from './accept-language'

/** Marcatore visibile aggiunto al percorso di atterraggio (il cookie resta la fonte per i soldi). */
const MARKERS = 'ref=nestor&utm_source=affiliate&utm_medium=referral&utm_campaign=nestor'

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
function proxiedRequest(path: string, acceptLanguage?: string): NextRequest {
  const headers: Record<string, string> = { host: '0.0.0.0:8080' }
  if (acceptLanguage !== undefined) headers['accept-language'] = acceptLanguage
  return new NextRequest(new Request(`http://0.0.0.0:8080${path}`, { headers }))
}

async function callRoute(path: string, slug = 'nestor', acceptLanguage?: string) {
  const response = await GET(proxiedRequest(path, acceptLanguage), {
    params: Promise.resolve({ locale: path.split('/')[1] ?? 'it', slug }),
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
  assert.equal(result.location, `/it?${MARKERS}`)
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
  assert.ok(!String(result.location).includes('ref='), 'no visible marker without a resolved affiliate')
  assert.ok(!String(result.cookie).includes('foolish_ref'), 'no referral cookie for an unknown slug')
})

test('an internal ?to= target stays relative and keeps query and hash', async () => {
  const result = await callRoute('/it/a/nestor?to=%2Fprodotti%3Fcolore%3Dnero%23top')

  assert.equal(result.location, `/prodotti?colore=nero&${MARKERS}#top`)
})

test('an escaping ?to= target falls back to the locale home, still relative', async () => {
  const result = await callRoute('/it/a/nestor?to=%2F%2Fevil.com')

  assert.equal(result.location, `/it?${MARKERS}`)
  assert.ok(!String(result.location).includes('evil.com'))
})

// The shop localises a language-less URL from the browser (/ + a Spanish browser
// answers 307 /es), so the neutral link must do the same instead of pinning every
// visitor to Italian.

test('the neutral link localises to the visitor language', async () => {
  const spanish = await callRoute('/it/a/nestor', 'nestor', 'es-ES,es;q=0.9,en;q=0.8')
  const german = await callRoute('/it/a/nestor', 'nestor', 'de')

  assert.equal(spanish.location, `/es?${MARKERS}`)
  assert.equal(german.location, `/de?${MARKERS}`)
  // The discount must survive the language switch: the cookie belongs to the
  // response, not to the language.
  assert.match(String(spanish.cookie), /foolish_ref=nestor/)
})

test('an unsupported visitor language falls back to the link language', async () => {
  const result = await callRoute('/it/a/nestor', 'nestor', 'pt-BR,pt;q=0.9')

  assert.equal(result.location, `/it?${MARKERS}`)
})

test('quality values decide, not the order of the header', async () => {
  const result = await callRoute('/it/a/nestor', 'nestor', 'es;q=0.3, fr;q=0.9')

  assert.equal(result.location, `/fr?${MARKERS}`)
})

test('a language-specific link keeps its own language', async () => {
  const result = await callRoute('/es/a/nestor', 'nestor', 'de-DE,de;q=0.9')

  assert.equal(result.location, `/es?${MARKERS}`)
})

test('an explicit ?to= target is never re-localised', async () => {
  const result = await callRoute('/it/a/nestor?to=%2Fprodotti', 'nestor', 'es-ES,es;q=0.9')

  assert.equal(result.location, `/prodotti?${MARKERS}`)
})

test('a malformed or empty language header is not a preference', async () => {
  const empty = await callRoute('/it/a/nestor', 'nestor', '')
  const wildcard = await callRoute('/it/a/nestor', 'nestor', '*')
  const rejected = await callRoute('/it/a/nestor', 'nestor', 'es;q=0')

  assert.equal(empty.location, `/it?${MARKERS}`)
  assert.equal(wildcard.location, `/it?${MARKERS}`)
  assert.equal(rejected.location, `/it?${MARKERS}`)
})

test('the visible marker and the cookie always name the same affiliate', async () => {
  const result = await callRoute('/it/a/nestor')
  const location = String(result.location)
  const cookie = String(result.cookie)

  const fromUrl = new URLSearchParams(location.split('?')[1] ?? '').get('ref')
  const fromCookie = /foolish_ref=([^;]+)/.exec(cookie)?.[1] ?? null

  assert.equal(fromUrl, 'nestor')
  // Se un giorno i due divergessero, l'URL mostrerebbe un affiliato e la
  // commissione andrebbe a un altro: il test lo blocca qui.
  assert.equal(fromUrl, fromCookie)
})

test('the language parser handles case, subtags and junk without throwing', () => {
  const locales = ['it', 'en', 'fr', 'es', 'de']

  assert.equal(preferredLocale('ES-es', locales), 'es')
  assert.equal(preferredLocale('es-MX,es;q=0.8', locales), 'es')
  assert.equal(preferredLocale('  fr ; q=0.7 , de;q=0.5 ', locales), 'fr')
  assert.equal(preferredLocale('de;q=0.5,es;q=0.9', locales), 'es')
  assert.equal(preferredLocale('zz-ZZ,pt;q=0.4', locales), null)
  assert.equal(preferredLocale('q=0.9', locales), null)
  assert.equal(preferredLocale('', locales), null)
  assert.equal(preferredLocale(undefined, locales), null)
  assert.equal(preferredLocale(null, locales), null)
  assert.equal(preferredLocale('es', []), null)
})
