import crypto from 'node:crypto'

type CmsId = string | number

export const AFFILIATE_REFERRAL_COOKIE = 'foolish_ref'
export const AFFILIATE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/

/**
 * Upper bound for the referral window regardless of the CMS value. The CMS field
 * allows up to 3650 days, which is a marketing/config convenience; a referral
 * link that can overwrite attribution for a decade is an unnecessary surface.
 */
export const REFERRAL_MAX_WINDOW_DAYS = 180
const MAX_REDIRECT_VALUE_LENGTH = 2048
/** Control characters and backslashes never belong in an internal path. */
const FORBIDDEN_REDIRECT_CHARS = /[\u0000-\u001f\u007f\\]/

const CMS_DEFAULT_URL = 'https://cms-production-1e56.up.railway.app'
const MAX_STATS_CONVERSIONS = 500
const STATS_TOKEN_LENGTH = 32

/** Affiliate record as returned by the CMS, before the promo code is resolved. */
export interface ReferralAffiliateRecord {
  id: CmsId
  slug: string
  /** Relationship id of the affiliate's promo code (`promo_code_id`). */
  promoCodeId: CmsId
  commissionBaseRateBps: number | null
  commissionStepRateBps: number | null
  commissionStepThresholdCents: number | null
  commissionMaxRateBps: number | null
  cookieWindowDays: number | null
}

/** Affiliate ready to be used: the promo code text has been resolved and validated. */
export interface ReferralAffiliate extends ReferralAffiliateRecord {
  promoCode: string
}

export interface AffiliateStatsConversion {
  eligibleAmountCents: number
  commissionAmountCents: number
  commissionRateBps: number
  paymentStatus: string
  refundStatus: string
  paidAt: string | null
}

export interface AffiliateStats {
  salesCount: number
  eligibleAmountCents: number
  commissionAmountCents: number
  currentRateBps: number
  refundedCount: number
  lastPaidAt: string | null
}

export type Fetcher = (url: string, init?: { headers?: Record<string, string>; cache?: string }) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeCmsId(value: unknown): CmsId | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 1 ? value : null
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized.length > 0 && normalized.length <= 128 ? normalized : null
  }
  return null
}

/**
 * Reads the affiliate's promo relationship. Payload serializes a relationship as
 * a numeric id at `depth=0` and as an object at `depth>=1`; both shapes are
 * accepted, anything else (including a bare string code) is not the contract.
 */
function readPromoRelation(value: unknown): CmsId | null {
  if (typeof value === 'number') return safeCmsId(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return safeCmsId(Number(value.trim()))
  if (isRecord(value)) return safeCmsId(value.id)
  return null
}

function boundedCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) {
    return value
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

/** Normalizes a slug coming from a URL or cookie; returns null when malformed. */
export function normalizeAffiliateSlug(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return AFFILIATE_SLUG_RE.test(normalized) ? normalized : null
}

/**
 * Validates the `?to=` landing target of a referral link.
 *
 * Only a root-relative path is accepted: no absolute URLs and no network-path
 * references. The value must be resolved before it is judged — the WHATWG parser
 * strips tab/CR/LF, so "/<tab>/evil.com" becomes "//evil.com" — AND the value
 * that is RETURNED must be re-resolved and re-checked, because normalisation can
 * itself produce an escaping pathname ("/.//evil.com" also normalises to
 * "//evil.com"). Validating the input alone is not enough.
 *
 * Returns a same-origin path (with query and hash) or null.
 */
export function safeRedirectTarget(value: unknown, requestUrl: string): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_VALUE_LENGTH) return null
  if (FORBIDDEN_REDIRECT_CHARS.test(value)) return null
  // A whitespace-only value would resolve to the current URL — the referral link
  // itself — and bounce the visitor in a redirect loop.
  if (value.trim().length === 0) return null
  // Root-relative paths only. This is the documented contract of `?to=` and it
  // removes the absolute-URL and protocol-relative forms entirely.
  if (!value.startsWith('/') || value.startsWith('//')) return null

  let requestOrigin: string
  try {
    requestOrigin = new URL(requestUrl).origin
  } catch {
    return null
  }

  let resolved: URL
  try {
    resolved = new URL(value, requestUrl)
  } catch {
    return null
  }
  if (resolved.origin !== requestOrigin) return null

  const candidate = `${resolved.pathname}${resolved.search}${resolved.hash}`

  // Validate the output, not just the input: a normalised pathname can begin
  // with '//' (network-path reference), and the caller — and any browser —
  // re-resolves this string, which would leave the site. `/.//` normalises to
  // the unparseable '//' as well, so the re-parse is also what keeps the route
  // from throwing on a malformed Location.
  if (candidate.startsWith('//')) return null

  let reparsed: URL
  try {
    reparsed = new URL(candidate, requestUrl)
  } catch {
    return null
  }
  if (reparsed.origin !== requestOrigin) return null
  if (!reparsed.pathname.startsWith('/') || reparsed.pathname.startsWith('//')) return null

  return candidate
}

const ACTIVE_STATUS = 'active'
/** Statuses that may still read their own historical reporting. */
const REPORTING_STATUSES = new Set(['active', 'paused', 'archived'])

/**
 * Fail-closed affiliate resolution from a raw CMS response. The promo code is
 * NOT read here: it is a relationship, and its text lives on `promo-codes`.
 */
export function resolveReferralAffiliate(
  docs: unknown,
  options: { allowInactive?: boolean } = {},
): ReferralAffiliateRecord | null {
  if (!Array.isArray(docs) || docs.length !== 1) return null

  const affiliate = docs[0]
  if (!isRecord(affiliate)) return null

  const id = safeCmsId(affiliate.id)
  // The CMS slug validator stores canonical lowercase slugs. A document that is
  // not already canonical would resolve to a slug the CMS cannot look up again,
  // so it is rejected instead of silently normalized.
  const rawSlug = typeof affiliate.slug === 'string' ? affiliate.slug : null
  const slug = normalizeAffiliateSlug(rawSlug)
  const promoCodeId = readPromoRelation(affiliate.promoCode)
  const rawStatus = typeof affiliate.status === 'string' ? affiliate.status : null
  const statusAllowed = options.allowInactive === true
    ? rawStatus !== null && REPORTING_STATUSES.has(rawStatus)
    : rawStatus === ACTIVE_STATUS

  if (
    !statusAllowed
    || id === null
    || rawSlug === null
    || rawSlug !== slug
    || slug === null
    || promoCodeId === null
  ) return null

  return {
    id,
    slug,
    promoCodeId,
    commissionBaseRateBps: boundedCents(affiliate.commissionBaseRateBps),
    commissionStepRateBps: boundedCents(affiliate.commissionStepRateBps),
    commissionStepThresholdCents: boundedCents(affiliate.commissionStepThresholdCents),
    commissionMaxRateBps: boundedCents(affiliate.commissionMaxRateBps),
    cookieWindowDays: boundedCents(affiliate.cookieWindowDays),
  }
}

/**
 * Validates a promo code document and returns its canonical text. A promo code
 * used for affiliate attribution must be active and of type `percent`, which is
 * exactly what the Affiliates collection validator enforces.
 */
export function parseAffiliatePromoCode(document: unknown): string | null {
  if (!isRecord(document)) return null
  if (document.active !== true) return null
  if (document.type !== 'percent') return null

  const code = typeof document.code === 'string' ? document.code.trim().toUpperCase() : null
  return code !== null && PROMO_CODE_RE.test(code) ? code : null
}

/**
 * Cookie lifetime in seconds for a referral, bounded by the affiliate's
 * configured window and by REFERRAL_MAX_WINDOW_DAYS. Returns null when no cookie
 * should be written (window zero or unusable configuration).
 */
export function referralCookieMaxAgeSeconds(cookieWindowDays: number | null): number | null {
  if (cookieWindowDays === null || !Number.isSafeInteger(cookieWindowDays) || cookieWindowDays < 0) return null
  if (cookieWindowDays === 0) return null
  return Math.min(cookieWindowDays, REFERRAL_MAX_WINDOW_DAYS) * 24 * 60 * 60
}

/**
 * Threshold at which the next commission step starts, or null when the tier
 * configuration is incomplete or the cap has already been reached.
 */
export function nextTierThresholdCents(
  affiliate: Pick<ReferralAffiliate, 'commissionStepThresholdCents' | 'commissionStepRateBps' | 'commissionMaxRateBps'>,
  stats: Pick<AffiliateStats, 'eligibleAmountCents' | 'currentRateBps'>,
): number | null {
  const threshold = affiliate.commissionStepThresholdCents
  const step = affiliate.commissionStepRateBps
  const cap = affiliate.commissionMaxRateBps
  if (threshold === null || step === null || threshold < 1 || step < 1) return null
  if (cap !== null && stats.currentRateBps >= cap) return null

  const reachedTiers = Math.floor(stats.eligibleAmountCents / threshold)
  return (reachedTiers + 1) * threshold
}

function cmsUrl(): string {
  return process.env.PAYLOAD_PUBLIC_URL || CMS_DEFAULT_URL
}

function defaultFetcher(): Fetcher {
  return fetch as unknown as Fetcher
}

async function cmsJson(fetcher: Fetcher, path: string, secret: string): Promise<unknown | null> {
  try {
    const response = await fetcher(`${cmsUrl()}${path}`, {
      headers: { 'x-storefront-secret': secret },
      cache: 'no-store',
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

/** Affiliate plus the resolved promo code text, for reporting use. */
export interface ReferralAffiliateForReport extends ReferralAffiliateRecord {
  promoCode: string | null
}

async function resolveAffiliate(
  slug: string,
  options: { fetcher?: Fetcher; allowInactive?: boolean; requirePromoCode?: boolean },
): Promise<ReferralAffiliateForReport | null> {
  const normalizedSlug = normalizeAffiliateSlug(slug)
  const secret = process.env.PAYLOAD_API_SECRET
  if (normalizedSlug === null || !secret) return null

  const fetcher = options.fetcher ?? defaultFetcher()
  const statusFilter = options.allowInactive === true ? '' : `&where[status][equals]=${ACTIVE_STATUS}`
  const affiliatePayload = await cmsJson(
    fetcher,
    `/api/affiliates?where[slug][equals]=${encodeURIComponent(normalizedSlug)}${statusFilter}&depth=0&limit=2`,
    secret,
  )
  if (!isRecord(affiliatePayload)) return null

  const record = resolveReferralAffiliate(affiliatePayload.docs, { allowInactive: options.allowInactive })
  if (!record) return null
  // Defence in depth: never trust the filter to have been honoured. If a proxy,
  // a cache, or a Payload bug returned a different affiliate, the sale would be
  // attributed to the wrong person instead of failing closed.
  if (record.slug !== normalizedSlug) return null

  const promoPayload = await cmsJson(
    fetcher,
    `/api/promo-codes?where[id][equals]=${encodeURIComponent(String(record.promoCodeId))}&depth=0&limit=1`,
    secret,
  )
  if (!isRecord(promoPayload) || !Array.isArray(promoPayload.docs) || promoPayload.docs.length !== 1) {
    if (options.requirePromoCode === false) return { ...record, promoCode: null }
    return null
  }

  const promoCode = parseAffiliatePromoCode(promoPayload.docs[0])
  if (promoCode === null) {
    if (options.requirePromoCode === false) return { ...record, promoCode: null }
    return null
  }

  return { ...record, promoCode }
}

/**
 * Resolves the affiliate behind a referral slug, including the text of its promo
 * code. Any missing secret, CMS error, unexpected payload, or unusable promo
 * code fails closed by returning null. This is the money path: it requires an
 * active affiliate with an active percent promo code.
 */
export async function resolveAffiliateBySlug(
  slug: string,
  options: { fetcher?: Fetcher } = {},
): Promise<ReferralAffiliate | null> {
  const resolved = await resolveAffiliate(slug, { ...options, requirePromoCode: true })
  if (!resolved || resolved.promoCode === null) return null
  return { ...resolved, promoCode: resolved.promoCode }
}

/**
 * Resolves the affiliate for its own reporting page. Reporting must survive a
 * commercial status change — pausing or archiving an affiliate stops the
 * discount but must not erase the figures it already earned. The promo code is
 * optional here because a deactivated code no longer exists to be read.
 */
export async function resolveAffiliateForReport(
  slug: string,
  options: { fetcher?: Fetcher } = {},
): Promise<ReferralAffiliateForReport | null> {
  return resolveAffiliate(slug, { ...options, allowInactive: true, requirePromoCode: false })
}

/**
 * Reads the affiliate's conversions. Returns null when the CMS is unreachable
 * or the payload cannot be trusted, so callers never render partial numbers.
 */
export async function fetchAffiliateConversions(
  affiliateId: CmsId,
  options: { fetcher?: Fetcher } = {},
): Promise<AffiliateStatsConversion[] | null> {
  const secret = process.env.PAYLOAD_API_SECRET
  const id = safeCmsId(affiliateId)
  if (id === null || !secret) return null

  const fetcher = options.fetcher ?? defaultFetcher()
  const payload = await cmsJson(
    fetcher,
    `/api/affiliate-conversions?where[affiliate][equals]=${encodeURIComponent(String(id))}`
    // One row over the limit acts as a truncation probe that does not depend on
    // the CMS reporting `totalDocs`.
    + `&depth=0&limit=${MAX_STATS_CONVERSIONS + 1}&sort=-paidAt`,
    secret,
  )
  if (!isRecord(payload) || !Array.isArray(payload.docs)) return null

  // Never present a truncated aggregate as a total: partial numbers would
  // understate what the affiliate earned.
  if (payload.docs.length > MAX_STATS_CONVERSIONS) return null
  const totalDocs = boundedCents(payload.totalDocs)
  if (totalDocs === null || totalDocs !== payload.docs.length) return null

  const conversions: AffiliateStatsConversion[] = []
  for (const entry of payload.docs) {
    if (!isRecord(entry)) return null

    const eligibleAmountCents = boundedCents(entry.eligibleAmountCents)
    const commissionAmountCents = boundedCents(entry.commissionAmountCents)
    const commissionRateBps = boundedCents(entry.commissionRateBps)
    const paymentStatus = entry.paymentStatus
    const refundStatus = entry.refundStatus
    if (
      eligibleAmountCents === null
      || commissionAmountCents === null
      || commissionRateBps === null
      || typeof paymentStatus !== 'string'
      || typeof refundStatus !== 'string'
    ) return null

    conversions.push({
      eligibleAmountCents,
      commissionAmountCents,
      commissionRateBps,
      paymentStatus,
      refundStatus,
      paidAt: typeof entry.paidAt === 'string' && Number.isFinite(Date.parse(entry.paidAt)) ? entry.paidAt : null,
    })
  }

  return conversions
}

function isEligibleConversion(conversion: AffiliateStatsConversion): boolean {
  return conversion.paymentStatus === 'paid' || conversion.paymentStatus === 'partially_refunded'
}

/**
 * Pure aggregation of the stored ledger. Only eligible rows contribute to both
 * the eligible amount and the accrued commission, so the two totals can never
 * disagree about which sales count.
 */
export function summarizeAffiliateStats(conversions: AffiliateStatsConversion[]): AffiliateStats {
  let eligibleAmountCents = 0
  let commissionAmountCents = 0
  let salesCount = 0
  let lastPaidAt: string | null = null
  let currentRateBps = 0
  let firstEligible = true

  for (const conversion of conversions) {
    if (!isEligibleConversion(conversion)) continue
    salesCount += 1
    eligibleAmountCents += conversion.eligibleAmountCents
    commissionAmountCents += conversion.commissionAmountCents
    // The rows arrive newest first: the rate comes from the newest eligible sale,
    // while the displayed date falls back to the newest row that actually has one
    // instead of showing '—' for a missing timestamp.
    if (firstEligible) {
      currentRateBps = conversion.commissionRateBps
      firstEligible = false
    }
    if (lastPaidAt === null && conversion.paidAt !== null) lastPaidAt = conversion.paidAt
  }

  return {
    salesCount,
    eligibleAmountCents,
    commissionAmountCents,
    currentRateBps,
    refundedCount: conversions.filter((c) => c.refundStatus === 'full').length,
    lastPaidAt,
  }
}

function statsSecret(): string | null {
  return process.env.AFFILIATE_STATS_SECRET || null
}

/**
 * Deterministic private token for an affiliate's stats page. It uses a dedicated
 * secret so that leaking the storefront/CMS API secret does not also let anyone
 * forge the stats links of every affiliate.
 */
export function buildAffiliateStatsToken(slug: string): string | null {
  const normalizedSlug = normalizeAffiliateSlug(slug)
  const secret = statsSecret()
  if (normalizedSlug === null || !secret) return null

  return crypto
    .createHmac('sha256', secret)
    .update(`affiliate-stats:${normalizedSlug}`)
    .digest('hex')
    .slice(0, STATS_TOKEN_LENGTH)
}

/** Timing-safe token comparison; fails closed on any malformed input. */
export function verifyAffiliateStatsToken(slug: string, token: unknown): boolean {
  if (typeof token !== 'string' || token.length !== STATS_TOKEN_LENGTH || !/^[a-f0-9]+$/.test(token)) return false

  const expected = buildAffiliateStatsToken(slug)
  if (expected === null || expected.length !== token.length) return false

  return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(token, 'utf8'))
}
