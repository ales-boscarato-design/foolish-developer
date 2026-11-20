import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_ATTRIBUTION_METADATA_LENGTH,
  UNKNOWN_ATTRIBUTION,
  EMPTY_ATTRIBUTION,
  buildAttributionMetadata,
  normalizeAttribution,
  parseAttributionMetadata,
} from './attribution'

test('direct visit stores path and has no referrer or UTM', () => {
  const value = normalizeAttribution({
    landingPath: '/it/', referrerHost: null, utmSource: null, utmMedium: null,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'direct',
  })
  assert.equal(value.landingPath, '/it/')
  assert.equal(value.referrerHost, null)
  assert.equal(value.sourceClass, 'direct')
  assert.deepEqual([value.utmSource, value.utmMedium, value.utmCampaign, value.utmTerm, value.utmContent], [null, null, null, null, null])
})

test('direct da landing non-whitelist conserva la classe senza serializzare il path', () => {
  const value = normalizeAttribution({
    landingPath: '/it/prodotto/example', referrerHost: null, utmSource: null, utmMedium: null,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'direct',
  })
  assert.equal(value.landingPath, null)
  assert.equal(value.sourceClass, 'direct')
  const json = buildAttributionMetadata(value)
  assert.ok(json)
  assert.equal(json.includes('/it/prodotto/example'), false)
  assert.deepEqual(JSON.parse(json), {
    landingPath: null, referrerHost: null, utmSource: null, utmMedium: null,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'direct',
  })
})

test('referrer saves hostname only, never query/path', () => {
  const value = normalizeAttribution({ landingPath: '/', referrerHost: 'https://www.google.com/search?q=pelle+sintetica' })
  assert.equal(value.referrerHost, 'google.com')
  assert.equal(value.sourceClass, 'organicSearch')
  assert.ok(!JSON.stringify(value).includes('pelle+sintetica'))
  for (const referrerHost of ['google.com', 'www.google.co.uk', 'search.brave.com']) {
    assert.equal(normalizeAttribution({ referrerHost }).sourceClass, 'organicSearch')
  }
  const cases = [
    ['https://www.instagram.com/p/xyz', 'instagram.com', 'organicSocial'],
    ['https://www.google.it/search?q=...', 'google.it', 'organicSearch'],
    ['https://news.google.com/...', null, 'unknown'],
    ['https://notgoogle.com/x', null, 'unknown'],
    ['https://www.facebook.com/...', 'facebook.com', 'organicSocial'],
  ] as const
  for (const [referrer, host, sourceClass] of cases) {
    const classified = normalizeAttribution({ referrerHost: referrer })
    assert.equal(classified.referrerHost, host)
    assert.equal(classified.sourceClass, sourceClass)
  }
  const google = normalizeAttribution({ referrerHost: 'https://www.google.com/search?q=pelle+sintetica' })
  assert.equal(google.referrerHost, 'google.com')
  assert.equal(google.sourceClass, 'organicSearch')
  assert.ok(!JSON.stringify(google).includes('pelle+sintetica'))
})

test('unknown and empty attribution are distinct objects', () => {
  assert.notEqual(EMPTY_ATTRIBUTION, UNKNOWN_ATTRIBUTION)
})

test('discarded UTM campaign data forces unknown even with an allowed source and medium', () => {
  const value = normalizeAttribution({ utmSource: ' GOOGLE_ADS ', utmMedium: ' CPC ', utmCampaign: 'spring', utmTerm: 'practice skin', utmContent: 'banner' })
  assert.deepEqual([value.utmSource, value.utmMedium, value.utmCampaign, value.utmTerm, value.utmContent], ['google_ads', 'cpc', null, null, null])
  assert.equal(value.sourceClass, 'unknown')
})

test('affiliate ref slug is omitted from analytics while generic source classification remains', () => {
  const value = normalizeAttribution({ refSlug: 'nestor', utmSource: 'affiliate', utmMedium: 'referral' })
  assert.equal(value.refSlug, null)
  assert.equal(value.utmSource, 'affiliate')
  assert.equal(value.utmMedium, 'referral')
  assert.equal(value.sourceClass, 'unknown')
})

test('missing inputs return unknown and have no metadata', () => {
  for (const input of [undefined, null]) assert.deepEqual(normalizeAttribution(input), UNKNOWN_ATTRIBUTION)
  assert.equal(buildAttributionMetadata(undefined), null)
})

test('malformed fields are discarded, sourceClass is never trusted, and helpers do not throw', () => {
  const value = normalizeAttribution({ landingPath: `/${'x'.repeat(200)}`, utmSource: 'x'.repeat(101), refSlug: 'Nestor ', referrerHost: 'https://user:pass@evil.com', sourceClass: 'paidAds', utmMedium: 'email' })
  assert.equal(value.landingPath, null)
  assert.equal(value.utmSource, null)
  assert.equal(value.refSlug, null)
  assert.equal(value.referrerHost, null)
  assert.equal(value.utmMedium, null)
  assert.equal(value.sourceClass, 'unknown')
  assert.doesNotThrow(() => buildAttributionMetadata({ landingPath: 'javascript:alert(1)' }))
  assert.equal(normalizeAttribution({ landingPath: 'javascript:alert(1)' }).landingPath, null)
})

test('untrusted oversized values are discarded and bounded metadata remains valid', () => {
  const json = buildAttributionMetadata({
    landingPath: `/${'x'.repeat(199)}`, referrerHost: 'h'.repeat(100),
    utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'c'.repeat(100), utmTerm: 't'.repeat(100), utmContent: 'd'.repeat(100), refSlug: 'a'.repeat(63),
  })
  assert.ok(json)
  assert.ok(json.length <= MAX_ATTRIBUTION_METADATA_LENGTH)
  const parsed = JSON.parse(json)
  assert.equal(parsed.sourceClass, 'unknown')
  assert.equal(parsed.refSlug, null)
  assert.deepEqual([parsed.landingPath, parsed.referrerHost, parsed.utmSource, parsed.utmMedium, parsed.utmCampaign, parsed.utmTerm, parsed.utmContent], [null, null, 'google', 'cpc', null, null, null])
})

test('Pro codes, personal slugs, emails, names, URLs and malicious parameters never survive', () => {
  const malicious = normalizeAttribution({
    landingPath: '/it/pro/card/PRO-CODE-123', refSlug: 'buyer-alessandro',
    referrerHost: 'https://buyer@example.com@evil.example/path?email=buyer@example.com',
    utmSource: 'buyer@example.com', utmMedium: 'Mario Rossi', utmCampaign: 'https://evil.example/?email=buyer@example.com',
    utmTerm: 'javascript:alert(1)', utmContent: '<img src=x>',
  })
  assert.deepEqual(malicious, UNKNOWN_ATTRIBUTION)
  const safe = normalizeAttribution({
    landingPath: '/it/', refSlug: 'PRO-CODE-123', referrerHost: 'https://www.google.com/search?q=buyer@example.com',
    utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'buyer@example.com', utmTerm: 'Mario Rossi', utmContent: 'https://evil.example/?x=1',
  })
  assert.deepEqual(safe, {
    landingPath: '/it/', referrerHost: 'google.com', utmSource: 'google', utmMedium: 'cpc',
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'unknown',
  })
})

test('metadata parser accepts valid snapshots and fails closed on invalid data', () => {
  const snapshot = normalizeAttribution({ landingPath: '/it/', utmSource: 'google', utmMedium: 'cpc' })
  assert.deepEqual(parseAttributionMetadata(JSON.stringify(snapshot)), snapshot)
  for (const raw of ['not json', 123, null, '{"sourceClass":"hacked"}']) assert.deepEqual(parseAttributionMetadata(raw), UNKNOWN_ATTRIBUTION)
})

test('direct requires actual absence; rejected inputs and replayed unknown stay unknown', () => {
  assert.equal(normalizeAttribution({ landingPath: '/it/', referrerHost: null }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({}).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ sourceClass: 'garbage' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ sourceClass: 'direct' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({
    landingPath: '/it/', referrerHost: null, utmSource: null, utmMedium: null,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'direct',
  }).sourceClass, 'direct')
  assert.equal(normalizeAttribution({ landingPath: '/it/', referrerHost: 'https://customer.example/path' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ landingPath: '/it/', utmSource: 'buyer@example.com' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ landingPath: '/it/', sourceClass: 'unknown' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ landingPath: '/it/', utmSource: 'buyer@example.com', utmMedium: 'cpc' }).sourceClass, 'unknown')
})

test('discarded campaign signal dominates otherwise recognized organic source', () => {
  assert.equal(normalizeAttribution({ landingPath: '/it/', utmSource: 'bing', utmMedium: 'email' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ landingPath: '/it/', referrerHost: 'https://www.google.com/search', utmMedium: 'newsletter' }).sourceClass, 'unknown')
  assert.equal(normalizeAttribution({ landingPath: '/it/', utmSource: 'bing' }).sourceClass, 'organicSearch')
  assert.equal(normalizeAttribution({ landingPath: '/it/', referrerHost: 'https://www.google.com/search' }).sourceClass, 'organicSearch')
  assert.equal(normalizeAttribution({ landingPath: '/it/', utmSource: 'google_ads', utmMedium: 'cpc' }).sourceClass, 'paidAds')
})
