import assert from 'node:assert/strict'
import test from 'node:test'
import { Orders } from '../collections/Orders'
import { sanitizeOrderAttribution } from './order-attribution'

test('CMS attribution boundary strips Pro codes, personal identifiers and arbitrary URLs', () => {
  const value = sanitizeOrderAttribution({
    landingPath: '/it/pro/card/PRO-CODE-123', referrerHost: 'https://evil.example/?email=buyer@example.com',
    utmSource: 'buyer@example.com', utmMedium: 'Mario Rossi', utmCampaign: 'https://evil.example/?name=Buyer',
    utmTerm: 'customer-slug', utmContent: 'PRO-CODE-123', refSlug: 'buyer-private-slug', sourceClass: 'paidAds',
  })
  assert.deepEqual(value, {
    landingPath: null, referrerHost: null, utmSource: null, utmMedium: null,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'unknown',
  })
})

test('CMS attribution boundary retains only locale home, public host and fixed source taxonomy', () => {
  const value = sanitizeOrderAttribution({
    landingPath: '/it/', referrerHost: 'https://www.google.com/search?q=private',
    utmSource: ' GOOGLE ', utmMedium: ' CPC ', utmCampaign: 'private campaign', refSlug: 'public-looking', sourceClass: 'unknown',
  })
  assert.deepEqual(value, {
    landingPath: '/it/', referrerHost: 'google.com', utmSource: 'google', utmMedium: 'cpc',
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'unknown',
  })
})

test('Orders real beforeChange hook preserves legacy unknown and authentic direct', async () => {
  const hook = Orders.hooks?.beforeChange?.find((candidate) => candidate.name === 'sanitizeAttributionField')
  assert.ok(hook, 'sanitizeAttributionField must be registered on Orders')

  const applyHook = async (attribution: unknown) => {
    const result = await hook({ data: { attribution } } as never)
    return (result as { attribution: unknown }).attribution
  }

  const emptyFields = {
    landingPath: null, referrerHost: null, utmSource: null, utmMedium: null,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null,
  }
  assert.deepEqual(await applyHook({}), {
    ...emptyFields, sourceClass: 'unknown',
  }, 'missing attribution is not proof of direct')
  assert.deepEqual(await applyHook({ sourceClass: 'garbage' }), {
    ...emptyFields, sourceClass: 'unknown',
  }, 'invalid sourceClass is not proof of direct')
  assert.deepEqual(await applyHook({ sourceClass: 'direct' }), {
    ...emptyFields, sourceClass: 'unknown',
  }, 'a partial direct marker is not a captured snapshot')
  assert.deepEqual(await applyHook({ ...emptyFields, sourceClass: 'unknown' }), {
    ...emptyFields, sourceClass: 'unknown',
  })
  assert.deepEqual(await applyHook({ ...emptyFields, landingPath: '/it/', sourceClass: 'unknown' }), {
    ...emptyFields, landingPath: '/it/', sourceClass: 'unknown',
  }, 'a landing path does not prove a source and cannot promote legacy unknown')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', utmSource: 'bing', sourceClass: 'unknown',
  }), {
    ...emptyFields, landingPath: '/it/', utmSource: 'bing', sourceClass: 'unknown',
  }, 'unknown from an earlier boundary dominates a retained source token')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', referrerHost: 'google.com', sourceClass: 'unknown',
  }), {
    ...emptyFields, landingPath: '/it/', referrerHost: 'google.com', sourceClass: 'unknown',
  }, 'unknown from an earlier boundary dominates a retained organic referrer')
  assert.deepEqual(await applyHook({ ...emptyFields, sourceClass: 'direct' }), {
    ...emptyFields, sourceClass: 'direct',
  })
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/pro/card/PRO-CODE-123', refSlug: 'private-customer-slug', sourceClass: 'unknown',
  }), {
    ...emptyFields, sourceClass: 'unknown',
  }, 'legacy unknown remains unknown after unsafe fields are stripped')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', sourceClass: 'direct',
  }), {
    ...emptyFields, landingPath: '/it/', sourceClass: 'direct',
  }, 'a real direct attribution with a retained landing page remains direct')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', utmSource: 'buyer@example.com', sourceClass: 'direct',
  }), {
    ...emptyFields, landingPath: '/it/', sourceClass: 'unknown',
  }, 'rejected legacy UTM cannot be rewritten as direct')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', utmSource: 'bing', utmMedium: 'email', sourceClass: 'organicSearch',
  }), {
    ...emptyFields, landingPath: '/it/', utmSource: 'bing', sourceClass: 'unknown',
  }, 'discarded medium overrides an otherwise recognized source')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', referrerHost: 'google.com', utmMedium: 'newsletter', sourceClass: 'organicSearch',
  }), {
    ...emptyFields, landingPath: '/it/', referrerHost: 'google.com', sourceClass: 'unknown',
  }, 'discarded newsletter medium overrides an otherwise organic referrer')
  assert.deepEqual(await applyHook({
    ...emptyFields, landingPath: '/it/', referrerHost: 'google.com', sourceClass: 'organicSearch',
  }), {
    ...emptyFields, landingPath: '/it/', referrerHost: 'google.com', sourceClass: 'organicSearch',
  }, 'genuine organic attribution remains organic')
})
