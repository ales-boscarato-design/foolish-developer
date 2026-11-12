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
  const value = normalizeAttribution({ landingPath: '/it/', referrerHost: null })
  assert.equal(value.landingPath, '/it/')
  assert.equal(value.referrerHost, null)
  assert.equal(value.sourceClass, 'direct')
  assert.deepEqual([value.utmSource, value.utmMedium, value.utmCampaign, value.utmTerm, value.utmContent], [null, null, null, null, null])
})

test('referrer saves hostname only, never query/path', () => {
  const value = normalizeAttribution({ landingPath: '/', referrerHost: 'https://www.google.com/search?q=pelle+sintetica' })
  assert.equal(value.referrerHost, 'google.com')
  assert.equal(value.sourceClass, 'organicSearch')
  assert.ok(!JSON.stringify(value).includes('pelle+sintetica'))
  for (const referrerHost of ['news.google.com', 'www.google.co.uk', 'search.brave.com']) {
    assert.equal(normalizeAttribution({ referrerHost }).sourceClass, 'organicSearch')
  }
  const cases = [
    ['https://www.instagram.com/p/xyz', 'instagram.com', 'organicSocial'],
    ['https://www.google.it/search?q=...', 'google.it', 'organicSearch'],
    ['https://news.google.com/...', 'news.google.com', 'organicSearch'],
    ['https://notgoogle.com/x', 'notgoogle.com', 'referral'],
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

test('UTMs trim, lowercase, cap at 100, and classify by priority', () => {
  const value = normalizeAttribution({ utmSource: ' GOOGLE_ADS ', utmMedium: ' CPC ', utmCampaign: ` ${'A'.repeat(101)} `, utmTerm: ' X ', utmContent: ' Y ' })
  assert.deepEqual([value.utmSource, value.utmMedium, value.utmCampaign, value.utmTerm, value.utmContent], ['google_ads', 'cpc', null, 'x', 'y'])
  assert.equal(value.sourceClass, 'paidAds')
})

test('affiliate ref and UTM coexist', () => {
  const value = normalizeAttribution({ refSlug: 'nestor', utmSource: 'affiliate', utmMedium: 'referral' })
  assert.equal(value.refSlug, 'nestor')
  assert.equal(value.utmSource, 'affiliate')
  assert.equal(value.utmMedium, 'referral')
  assert.equal(value.sourceClass, 'referral')
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
  assert.equal(value.utmMedium, 'email')
  assert.equal(value.sourceClass, 'referral')
  assert.doesNotThrow(() => buildAttributionMetadata({ landingPath: 'javascript:alert(1)' }))
  assert.equal(normalizeAttribution({ landingPath: 'javascript:alert(1)' }).landingPath, null)
})

test('worst-case compact metadata remains within 480 characters and preserves class and slug', () => {
  const json = buildAttributionMetadata({
    landingPath: `/${'x'.repeat(199)}`, referrerHost: 'h'.repeat(100),
    utmSource: 's'.repeat(100), utmMedium: 'm'.repeat(100), utmCampaign: 'c'.repeat(100), utmTerm: 't'.repeat(100), utmContent: 'd'.repeat(100), refSlug: 'a'.repeat(63),
  })
  assert.ok(json)
  assert.ok(json.length <= MAX_ATTRIBUTION_METADATA_LENGTH)
  const parsed = JSON.parse(json)
  assert.equal(parsed.sourceClass, 'referral')
  assert.equal(parsed.refSlug, 'a'.repeat(63))
})

test('metadata parser accepts valid snapshots and fails closed on invalid data', () => {
  const snapshot = normalizeAttribution({ landingPath: '/it/', utmSource: 'google', utmMedium: 'cpc' })
  assert.deepEqual(parseAttributionMetadata(JSON.stringify(snapshot)), snapshot)
  for (const raw of ['not json', 123, null, '{"sourceClass":"hacked"}']) assert.deepEqual(parseAttributionMetadata(raw), UNKNOWN_ATTRIBUTION)
})
