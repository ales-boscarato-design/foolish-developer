import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.PAYLOAD_API_SECRET = 'test-storefront-secret'
process.env.AFFILIATE_STATS_SECRET = 'test-stats-secret'

import {
  buildAffiliateStatsToken,
  fetchAffiliateConversions,
  nextTierThresholdCents,
  normalizeAffiliateSlug,
  parseAffiliatePromoCode,
  referralCookieMaxAgeSeconds,
  REFERRAL_MAX_WINDOW_DAYS,
  resolveAffiliateBySlug,
  resolveAffiliateForReport,
  resolveReferralAffiliate,
  safeRedirectTarget,
  summarizeAffiliateStats,
  verifyAffiliateStatsToken,
  type AffiliateStatsConversion,
  type Fetcher,
} from './affiliate-referral'

/**
 * Fixture shaped like the REAL Payload response: `promoCode` is a relationship,
 * so at depth=0 it is a numeric id — never the code text. A fixture that puts the
 * code text here hides a total failure of the feature.
 */
function affiliateDocument(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    slug: 'nestor',
    status: 'active',
    promoCode: 12,
    commissionBaseRateBps: 1500,
    commissionStepRateBps: 300,
    commissionStepThresholdCents: 50000,
    commissionMaxRateBps: 3800,
    cookieWindowDays: 30,
    ...overrides,
  }
}

function promoCodeDocument(overrides: Record<string, unknown> = {}) {
  return { id: 12, code: 'NESTOR15', type: 'percent', active: true, discountPercent: 15, ...overrides }
}

function conversion(overrides: Partial<AffiliateStatsConversion> = {}): AffiliateStatsConversion {
  return {
    eligibleAmountCents: 10000,
    commissionAmountCents: 1500,
    commissionRateBps: 1500,
    paymentStatus: 'paid',
    refundStatus: 'none',
    paidAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  }
}

/** Serves the two CMS calls that resolveAffiliateBySlug makes. */
function cmsFetcher(routes: { affiliates?: unknown; promo?: unknown; fail?: number[] }): Fetcher {
  return async (url) => {
    const status = routes.fail?.find((s) => s === 401 || s === 500) ?? 200
    const body = url.includes('/api/affiliates')
      ? routes.affiliates
      : url.includes('/api/promo-codes')
        ? routes.promo
        : undefined

    if (status !== 200) {
      return { ok: false, status, json: async () => ({ errors: [{ message: 'error' }] }) }
    }
    return { ok: status === 200, status, json: async () => body }
  }
}

test('normalizes a valid slug and rejects malformed input', () => {
  assert.equal(normalizeAffiliateSlug('nestor'), 'nestor')
  assert.equal(normalizeAffiliateSlug('  NESTOR  '), 'nestor')
  assert.equal(normalizeAffiliateSlug('nestor-tattoo-2'), 'nestor-tattoo-2')

  assert.equal(normalizeAffiliateSlug(''), null)
  assert.equal(normalizeAffiliateSlug('-nestor'), null)
  assert.equal(normalizeAffiliateSlug('nestor-'), null)
  assert.equal(normalizeAffiliateSlug('nestor tattoo'), null)
  assert.equal(normalizeAffiliateSlug('a'.repeat(64)), null)
  assert.equal(normalizeAffiliateSlug(undefined), null)
  assert.equal(normalizeAffiliateSlug(42), null)
})

test('resolves the affiliate relationship id from the real CMS shape', () => {
  const record = resolveReferralAffiliate([affiliateDocument()])
  assert.ok(record, 'a document with a numeric promoCode must resolve')
  assert.equal(record.id, 7)
  assert.equal(record.slug, 'nestor')
  assert.equal(record.promoCodeId, 12)
  assert.equal(record.commissionBaseRateBps, 1500)
  assert.equal(record.cookieWindowDays, 30)

  // depth>=1 serializes the relationship as an object: still accepted.
  assert.equal(resolveReferralAffiliate([affiliateDocument({ promoCode: { id: 12, code: 'NESTOR15' } })])?.promoCodeId, 12)
})

test('rejects an affiliate document whose promoCode is not a relationship', () => {
  // A bare code string is NOT the CMS contract for this field. Accepting it here
  // is what made the feature look correct in tests while being inert live.
  assert.equal(resolveReferralAffiliate([affiliateDocument({ promoCode: 'NESTOR15' })]), null)
  assert.equal(resolveReferralAffiliate([affiliateDocument({ promoCode: null })]), null)
  assert.equal(resolveReferralAffiliate([affiliateDocument({ promoCode: 0 })]), null)
})

test('rejects inactive, ambiguous, or non-canonical affiliate documents', () => {
  assert.equal(resolveReferralAffiliate([affiliateDocument({ status: 'paused' })]), null)
  assert.equal(resolveReferralAffiliate([affiliateDocument({ status: 'archived' })]), null)
  assert.equal(resolveReferralAffiliate([affiliateDocument({ slug: 'Nestor' })]), null)
  assert.equal(resolveReferralAffiliate([affiliateDocument({ id: 0 })]), null)
  assert.equal(resolveReferralAffiliate([]), null)
  assert.equal(resolveReferralAffiliate([affiliateDocument(), affiliateDocument({ id: 8 })]), null)
  assert.equal(resolveReferralAffiliate({ docs: [affiliateDocument()] }), null)
  assert.equal(resolveReferralAffiliate([null]), null)
})

test('accepts only an active percent promo code, canonicalized', () => {
  assert.equal(parseAffiliatePromoCode(promoCodeDocument()), 'NESTOR15')
  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ code: 'nestor15' })), 'NESTOR15')

  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ active: false })), null)
  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ type: 'percent_pro' })), null)
  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ type: 'free_shipping' })), null)
  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ type: 'amount' })), null)
  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ code: 'bad code' })), null)
  assert.equal(parseAffiliatePromoCode(promoCodeDocument({ code: '' })), null)
  assert.equal(parseAffiliatePromoCode(null), null)
})

test('resolves slug to promo code through both CMS calls (real contract)', async () => {
  const fetcher = cmsFetcher({
    affiliates: { docs: [affiliateDocument()] },
    promo: { docs: [promoCodeDocument()] },
  })

  const affiliate = await resolveAffiliateBySlug('nestor', { fetcher })
  assert.ok(affiliate, 'the composed resolution must produce an affiliate')
  assert.equal(affiliate.promoCode, 'NESTOR15')
  assert.equal(affiliate.promoCodeId, 12)
  assert.equal(affiliate.slug, 'nestor')
})

test('fails closed when the affiliate, the promo code, or the CMS is unusable', async () => {
  const emptyAffiliates = cmsFetcher({ affiliates: { docs: [] }, promo: { docs: [promoCodeDocument()] } })
  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: emptyAffiliates }), null)

  const inactivePromo = cmsFetcher({
    affiliates: { docs: [affiliateDocument()] },
    promo: { docs: [promoCodeDocument({ active: false })] },
  })
  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: inactivePromo }), null)

  const missingPromo = cmsFetcher({ affiliates: { docs: [affiliateDocument()] }, promo: { docs: [] } })
  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: missingPromo }), null)

  const twoPromos = cmsFetcher({
    affiliates: { docs: [affiliateDocument()] },
    promo: { docs: [promoCodeDocument(), promoCodeDocument({ id: 13 })] },
  })
  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: twoPromos }), null)

  const serverError = cmsFetcher({ fail: [500] })
  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: serverError }), null)

  assert.equal(await resolveAffiliateBySlug('Nestor', { fetcher: cmsFetcher({}) }), null)
  assert.equal(await resolveAffiliateBySlug('', { fetcher: cmsFetcher({}) }), null)
})

test('fails closed when the storefront secret is missing', async () => {
  const previous = process.env.PAYLOAD_API_SECRET
  delete process.env.PAYLOAD_API_SECRET
  try {
    const fetcher = cmsFetcher({ affiliates: { docs: [affiliateDocument()] }, promo: { docs: [promoCodeDocument()] } })
    assert.equal(await resolveAffiliateBySlug('nestor', { fetcher }), null)
  } finally {
    process.env.PAYLOAD_API_SECRET = previous
  }
})

test('summarizes the ledger counting eligible rows only, consistently', () => {
  const stats = summarizeAffiliateStats([
    conversion({ eligibleAmountCents: 10000, commissionAmountCents: 1500, commissionRateBps: 1500, paidAt: '2026-09-01T10:00:00.000Z' }),
    conversion({ eligibleAmountCents: 5000, commissionAmountCents: 900, commissionRateBps: 1800, paymentStatus: 'partially_refunded', refundStatus: 'partial', paidAt: '2026-09-05T10:00:00.000Z' }),
    conversion({ eligibleAmountCents: 20000, commissionAmountCents: 0, commissionRateBps: 1500, paymentStatus: 'refunded', refundStatus: 'full', paidAt: '2026-08-01T10:00:00.000Z' }),
    // A non-eligible row must not inflate the accrued commission even if it
    // carries a stale non-zero commission amount.
    conversion({ eligibleAmountCents: 7000, commissionAmountCents: 1050, paymentStatus: 'cancelled', refundStatus: 'none', paidAt: '2026-07-01T10:00:00.000Z' }),
  ])

  assert.equal(stats.salesCount, 2)
  assert.equal(stats.eligibleAmountCents, 15000)
  assert.equal(stats.commissionAmountCents, 2400)
  assert.equal(stats.currentRateBps, 1500)
  assert.equal(stats.refundedCount, 1)
  assert.equal(stats.lastPaidAt, '2026-09-01T10:00:00.000Z')
})

test('an empty ledger produces zeroed stats without throwing', () => {
  assert.deepEqual(summarizeAffiliateStats([]), {
    salesCount: 0,
    eligibleAmountCents: 0,
    commissionAmountCents: 0,
    currentRateBps: 0,
    refundedCount: 0,
    lastPaidAt: null,
  })
})

test('computes the next commission step threshold', () => {
  const affiliate = { commissionStepThresholdCents: 50000, commissionStepRateBps: 300, commissionMaxRateBps: 3800 }

  assert.equal(nextTierThresholdCents(affiliate, { eligibleAmountCents: 0, currentRateBps: 1500 }), 50000)
  assert.equal(nextTierThresholdCents(affiliate, { eligibleAmountCents: 49999, currentRateBps: 1500 }), 50000)
  assert.equal(nextTierThresholdCents(affiliate, { eligibleAmountCents: 50000, currentRateBps: 1800 }), 100000)
  assert.equal(nextTierThresholdCents(affiliate, { eligibleAmountCents: 125000, currentRateBps: 2100 }), 150000)

  assert.equal(nextTierThresholdCents(affiliate, { eligibleAmountCents: 400000, currentRateBps: 3800 }), null)
  assert.equal(nextTierThresholdCents({ ...affiliate, commissionStepRateBps: 0 }, { eligibleAmountCents: 0, currentRateBps: 1500 }), null)
  assert.equal(nextTierThresholdCents({ ...affiliate, commissionStepThresholdCents: null }, { eligibleAmountCents: 0, currentRateBps: 1500 }), null)
})

test('bounds the referral cookie lifetime, including the hard window cap', () => {
  assert.equal(referralCookieMaxAgeSeconds(30), 2592000)
  assert.equal(referralCookieMaxAgeSeconds(1), 86400)
  assert.equal(referralCookieMaxAgeSeconds(0), null)
  assert.equal(referralCookieMaxAgeSeconds(null), null)
  assert.equal(referralCookieMaxAgeSeconds(-1), null)

  // The CMS field allows up to 3650 days: the referral window is capped anyway.
  assert.equal(referralCookieMaxAgeSeconds(99999), REFERRAL_MAX_WINDOW_DAYS * 86400)
  assert.equal(referralCookieMaxAgeSeconds(3650), REFERRAL_MAX_WINDOW_DAYS * 86400)
})

test('builds a private stats token from the dedicated secret and verifies it safely', () => {
  const token = buildAffiliateStatsToken('nestor')
  assert.ok(token)
  assert.equal(token.length, 32)
  assert.equal(buildAffiliateStatsToken('nestor'), token)
  assert.equal(buildAffiliateStatsToken('NESTOR'), token)
  assert.notEqual(buildAffiliateStatsToken('another-affiliate'), token)

  assert.equal(verifyAffiliateStatsToken('nestor', token), true)
  assert.equal(verifyAffiliateStatsToken('nestor', 'a'.repeat(32)), false)
  assert.equal(verifyAffiliateStatsToken('nestor', token.toUpperCase()), false)
  assert.equal(verifyAffiliateStatsToken('nestor', token.slice(0, 31)), false)
  assert.equal(verifyAffiliateStatsToken('nestor', `${token}00`), false)
  assert.equal(verifyAffiliateStatsToken('nestor', 'z'.repeat(32)), false)
  assert.equal(verifyAffiliateStatsToken('nestor', undefined), false)
  assert.equal(verifyAffiliateStatsToken('nestor', 12345), false)
  assert.equal(verifyAffiliateStatsToken('another-affiliate', token), false)
})

test('stats token uses its own secret, not the storefront API secret', () => {
  const previousStats = process.env.AFFILIATE_STATS_SECRET
  const previousApi = process.env.PAYLOAD_API_SECRET
  const withStats = buildAffiliateStatsToken('nestor')

  try {
    delete process.env.AFFILIATE_STATS_SECRET
    // The storefront secret alone must not be enough to mint or verify a link.
    assert.equal(buildAffiliateStatsToken('nestor'), null)
    assert.equal(verifyAffiliateStatsToken('nestor', 'a'.repeat(32)), false)

    process.env.AFFILIATE_STATS_SECRET = 'a-different-secret'
    assert.notEqual(buildAffiliateStatsToken('nestor'), withStats)
  } finally {
    process.env.PAYLOAD_API_SECRET = previousApi
    if (previousStats === undefined) delete process.env.AFFILIATE_STATS_SECRET
    else process.env.AFFILIATE_STATS_SECRET = previousStats
  }
})

test('accepts an internal ?to= target and keeps path, query and hash', () => {
  const base = 'https://thefoolishbutcher.com/it/a/nestor'

  assert.equal(safeRedirectTarget('/it/prodotto/t-sheet-duoskin', base), '/it/prodotto/t-sheet-duoskin')
  assert.equal(safeRedirectTarget('/it?x=1#y', base), '/it?x=1#y')
  assert.equal(safeRedirectTarget('/it/prodotto/a%20b', base), '/it/prodotto/a%20b')
})

test('rejects every escaping ?to= target, including control-character tricks', () => {
  const base = 'https://thefoolishbutcher.com/it/a/nestor'

  // The parser strips tab/CR/LF, so "/<tab>/evil.com" becomes "//evil.com":
  // a prefix check on the raw string passes while the redirect escapes. These
  // three cases are the reason the target is resolved before it is judged.
  assert.equal(safeRedirectTarget('/\t/evil.com', base), null)
  assert.equal(safeRedirectTarget('/\r/evil.com', base), null)
  assert.equal(safeRedirectTarget('/\n/evil.com', base), null)

  assert.equal(safeRedirectTarget('//evil.com', base), null)
  assert.equal(safeRedirectTarget('/\\evil.com', base), null)
  assert.equal(safeRedirectTarget('https://evil.com', base), null)
  assert.equal(safeRedirectTarget('http://thefoolishbutcher.com/it', base), null)
  assert.equal(safeRedirectTarget('javascript:alert(1)', base), null)
  assert.equal(safeRedirectTarget('data:text/html,<script>1</script>', base), null)
  assert.equal(safeRedirectTarget('\u0000/it', base), null)

  assert.equal(safeRedirectTarget('', base), null)
  assert.equal(safeRedirectTarget('   ', base), null)
  assert.equal(safeRedirectTarget(undefined, base), null)
  assert.equal(safeRedirectTarget(42, base), null)
  assert.equal(safeRedirectTarget(`/${'a'.repeat(3000)}`, base), null)
  assert.equal(safeRedirectTarget('/it', 'not-a-url'), null)
})

test('rejects values whose NORMALISED path escapes (validating only input is not enough)', () => {
  const base = 'https://thefoolishbutcher.com/it/a/nestor'

  // Every one of these is same-origin as written, so an input-only origin check
  // passes — yet the normalised pathname starts with '//' and re-resolving the
  // returned string leaves the site. Found by an independent review after the
  // control-character fix.
  assert.equal(safeRedirectTarget('/.//evil.com', base), null)
  assert.equal(safeRedirectTarget('/..//evil.com', base), null)
  assert.equal(safeRedirectTarget('/it/..//evil.com', base), null)
  assert.equal(safeRedirectTarget('/%2e%2e//evil.com', base), null)

  // '//' is not even a parseable URL: the route would throw on it.
  assert.equal(safeRedirectTarget('/.//', base), null)
  assert.equal(safeRedirectTarget('/..//', base), null)
})

test('a doubled slash INSIDE the path stays on site (only a leading // is an authority)', () => {
  const base = 'https://thefoolishbutcher.com/it/a/nestor'

  // These normalise to "/it//evil.com". A "//" that does not begin the path is
  // just a doubled slash in the path: the host is unchanged, so this is not an
  // escape and refusing it would be security theatre.
  for (const value of ['/it/.//evil.com', '/it/%2e//evil.com']) {
    const target = safeRedirectTarget(value, base)
    assert.equal(target, '/it//evil.com')
    assert.equal(new URL(target, base).origin, new URL(base).origin)
  }
})

test('every accepted ?to= target re-resolves to the same origin (route post-condition)', () => {
  const base = 'https://thefoolishbutcher.com/it/a/nestor'

  const accepted = [
    '/it/prodotto/t-sheet-duoskin',
    '/it',
    '/it?x=1#y',
    '/it/prodotto/a%20b',
    '/',
    '/it/./prodotto',
    '/it/prodotto/../prodotti',
    '/it//doppia-barra-interna',
  ]

  for (const value of accepted) {
    const target = safeRedirectTarget(value, base)
    assert.ok(target !== null, `${value} should be accepted`)

    // This is exactly what the route does next: the returned string must parse
    // AND must still point at the site.
    const resolved = new URL(target, base)
    assert.equal(resolved.origin, new URL(base).origin, `${value} escaped the origin`)
    assert.ok(resolved.pathname.startsWith('/'), `${value} lost its leading slash`)
    assert.ok(!resolved.pathname.startsWith('//'), `${value} became protocol-relative`)
  }
})

test('reporting resolution survives a paused or archived affiliate', async () => {
  const paused = cmsFetcher({
    affiliates: { docs: [affiliateDocument({ status: 'paused' })] },
    promo: { docs: [promoCodeDocument()] },
  })

  // The money path must still refuse an inactive affiliate.
  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: paused }), null)

  // Reporting must keep working: the figures were already earned.
  const report = await resolveAffiliateForReport('nestor', { fetcher: paused })
  assert.ok(report)
  assert.equal(report.id, 7)
  assert.equal(report.promoCode, 'NESTOR15')

  const archivedWithoutCode = cmsFetcher({
    affiliates: { docs: [affiliateDocument({ status: 'archived' })] },
    promo: { docs: [] },
  })
  const reportWithoutCode = await resolveAffiliateForReport('nestor', { fetcher: archivedWithoutCode })
  assert.ok(reportWithoutCode)
  assert.equal(reportWithoutCode.promoCode, null)

  const unknown = cmsFetcher({ affiliates: { docs: [] }, promo: { docs: [] } })
  assert.equal(await resolveAffiliateForReport('nestor', { fetcher: unknown }), null)
})

test('refuses to report aggregates from a truncated ledger', async () => {
  const row = {
    eligibleAmountCents: 1000,
    commissionAmountCents: 150,
    commissionRateBps: 1500,
    paymentStatus: 'paid',
    refundStatus: 'none',
    paidAt: '2026-09-01T10:00:00.000Z',
  }
  const fetcherFor = (docs: unknown[], totalDocs?: unknown): Fetcher => async () => ({
    ok: true,
    status: 200,
    json: async () => (totalDocs === undefined ? { docs } : { docs, totalDocs }),
  })

  // Complete page: exactly the returned rows.
  const complete = await fetchAffiliateConversions(7, { fetcher: fetcherFor([row, row], 2) })
  assert.equal(complete?.length, 2)

  // The CMS says there are more rows than it returned: refuse, never understate.
  assert.equal(await fetchAffiliateConversions(7, { fetcher: fetcherFor([row], 900) }), null)
  // Missing totalDocs is not proof of completeness either.
  assert.equal(await fetchAffiliateConversions(7, { fetcher: fetcherFor([row]) }), null)
  // More rows than the supported maximum: refuse.
  assert.equal(await fetchAffiliateConversions(7, { fetcher: fetcherFor(new Array(501).fill(row), 501) }), null)
})

test('refuses an affiliate document whose slug is not the one requested', async () => {
  // A CMS, proxy, or cache that ignores the slug filter must not let a sale be
  // attributed to whoever came back first.
  const wrongAffiliate = cmsFetcher({
    affiliates: { docs: [affiliateDocument({ id: 99, slug: 'qualcunaltro' })] },
    promo: { docs: [promoCodeDocument()] },
  })

  assert.equal(await resolveAffiliateBySlug('nestor', { fetcher: wrongAffiliate }), null)
  assert.equal(await resolveAffiliateForReport('nestor', { fetcher: wrongAffiliate }), null)
})

test('shows the newest dated sale when the newest row has no date', () => {
  const stats = summarizeAffiliateStats([
    // Newest eligible row: no date, but it still carries the current rate.
    conversion({ commissionRateBps: 2100, paidAt: null }),
    conversion({ commissionRateBps: 1800, paidAt: '2026-09-09T10:00:00.000Z' }),
    conversion({ commissionRateBps: 1500, paidAt: '2026-08-01T10:00:00.000Z' }),
  ])

  assert.equal(stats.salesCount, 3)
  assert.equal(stats.currentRateBps, 2100)
  assert.equal(stats.lastPaidAt, '2026-09-09T10:00:00.000Z')
})
