import type Stripe from 'stripe'
import { normalizePromoCode, MAX_CART_SUBTOTAL_CENTS, MAX_CHECKOUT_ITEMS, MAX_ITEM_PRICE_CENTS } from './promo'

const CMS_DEFAULT_URL = 'https://cms-production-1e56.up.railway.app'
const MAX_SESSION_AMOUNT_CENTS = 1_000_000_000
const MAX_ITEM_QUANTITY = 100
const MAX_SLUG_LENGTH = 63
const AFFILIATE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

type CmsId = string | number

export interface AffiliateMetadataItem {
  priceCents: number
  qty: number
  excluded: boolean
}

export interface ParsedAffiliateItems {
  items: AffiliateMetadataItem[]
  eligibleAmountCents: number
}

export interface AffiliateRateConfig {
  baseRateBps: number
  stepRateBps: number
  thresholdCents: number
  maxRateBps: number
}

export interface AffiliatePromoCodeRecord {
  id?: unknown
  code?: unknown
  type?: unknown
  active?: unknown
}

export interface AffiliateRecord {
  id?: unknown
  slug?: unknown
  status?: unknown
  promoCode?: unknown
  commissionBaseRateBps?: unknown
  commissionStepRateBps?: unknown
  commissionStepThresholdCents?: unknown
  commissionMaxRateBps?: unknown
}

export interface AffiliateConversionRecord {
  id?: unknown
  stripeSessionId?: unknown
  stripePaymentIntentId?: unknown
  orderNumber?: unknown
  affiliate?: unknown
  promoCodeSnapshot?: unknown
  affiliateSlugSnapshot?: unknown
  eligibleAmountCents?: unknown
  commissionRateBps?: unknown
  commissionAmountCents?: unknown
  currency?: unknown
  paymentStatus?: unknown
  refundStatus?: unknown
  amountRefundedCents?: unknown
}

export interface AffiliateConversionCreatePayload {
  stripeSessionId: string
  stripePaymentIntentId: string
  orderNumber: string
  affiliate: CmsId
  promoCodeSnapshot: string
  affiliateSlugSnapshot: string
  eligibleAmountCents: number
  currency: 'EUR'
  paidAt: string
}

export interface AffiliateConversionCreateResult extends AffiliateConversionRecord {
  status: 'created' | 'existing'
  stripeSessionId: string
  stripePaymentIntentId: string
  orderNumber: string
  affiliate: CmsId
  promoCodeSnapshot: string
  affiliateSlugSnapshot: string
  eligibleAmountCents: number
  commissionRateBps: number
  commissionAmountCents: number
  currency: 'EUR'
  paymentStatus: 'paid' | 'refunded' | 'partially_refunded' | 'cancelled'
  refundStatus: 'none' | 'partial' | 'full'
  amountRefundedCents: number
}

export interface AffiliateOrderPatch {
  affiliatePromoCode: string
  affiliateSlug: string
  affiliateEligibleAmountCents: number
  affiliateCommissionRateBps: number
  affiliateCommissionCents: number
}

export type AffiliateOrderAttributionResult =
  | { status: 'patched' }
  | { status: 'refunded' }

export interface AffiliateConversionPaymentStatusPatch {
  paymentStatus: 'refunded' | 'partially_refunded'
  refundStatus: 'full' | 'partial'
  amountRefundedCents: number
  commissionAmountCents?: 0
}

export type AffiliateConversionPaymentStatusUpdateResult =
  | { status: 'updated' }
  | { status: 'missing' }
  | { status: 'stale' }

export type AffiliateChargeRefundResult =
  | AffiliateConversionPaymentStatusUpdateResult
  | { status: 'non_affiliate' }

export interface AffiliateConversionPaymentStatusCms {
  updateConversionPaymentStatusByPaymentIntent(
    stripePaymentIntentId: string,
    patch: AffiliateConversionPaymentStatusPatch,
  ): Promise<AffiliateConversionPaymentStatusUpdateResult>
}

export interface AffiliateAttributionCms {
  findPromoCodesByExactCode(code: string): Promise<AffiliatePromoCodeRecord[]>
  findAffiliateByIdAndPromoCode(affiliateId: CmsId, promoCodeId: CmsId): Promise<AffiliateRecord[]>
  findConversionByStripeSessionId(stripeSessionId: string): Promise<AffiliateConversionRecord | null>
  createOrGetConversion(payload: AffiliateConversionCreatePayload): Promise<AffiliateConversionCreateResult>
  patchOrderByNumber(orderNumber: string, patch: AffiliateOrderPatch, stripeSessionId: string, stripePaymentIntentId: string): Promise<AffiliateOrderAttributionResult | void>
  updateConversionPaymentStatusByPaymentIntent(
    stripePaymentIntentId: string,
    patch: AffiliateConversionPaymentStatusPatch,
  ): Promise<AffiliateConversionPaymentStatusUpdateResult>
}

export type AffiliateAttributionErrorCode =
  | 'metadata_invalid'
  | 'promo_lookup_failed'
  | 'promo_missing'
  | 'promo_ambiguous'
  | 'promo_invalid'
  | 'affiliate_lookup_failed'
  | 'affiliate_missing'
  | 'affiliate_ambiguous'
  | 'affiliate_invalid'
  | 'ledger_lookup_failed'
  | 'ledger_inconsistent'
  | 'ledger_write_failed'
  | 'order_patch_failed'

export class AffiliateAttributionError extends Error {
  readonly code: AffiliateAttributionErrorCode

  constructor(code: AffiliateAttributionErrorCode) {
    super(code)
    this.name = 'AffiliateAttributionError'
    this.code = code
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function safeId(value: unknown): CmsId | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 1 ? value : null
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized.length > 0 && normalized.length <= 128 ? normalized : null
  }
  return null
}

function relationId(value: unknown): CmsId | null {
  if (isPlainObject(value) && 'id' in value) return safeId(value.id)
  return safeId(value)
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= min
    && value <= max
    ? value
    : null
}

function parsePriceCents(item: Record<string, unknown>): number | null {
  const priceCents = item.priceCents
  const price = item.price
  let parsed: number | null = null

  if (priceCents !== undefined) {
    parsed = boundedInteger(priceCents, 0, MAX_ITEM_PRICE_CENTS)
  } else if (typeof price === 'number' && Number.isFinite(price) && price >= 0) {
    const rounded = Math.round(price * 100)
    // Server metadata currently stores charged unit prices in euros. Require
    // an exact cent value before converting, so floating-point noise cannot
    // turn malformed prices into eligible commissionable amounts.
    parsed = Number.isSafeInteger(rounded)
      && rounded <= MAX_ITEM_PRICE_CENTS
      && Math.abs(price - rounded / 100) < 1e-8
      ? rounded
      : null
  }

  if (parsed === null) return null
  if (priceCents !== undefined && price !== undefined) {
    if (typeof price !== 'number' || !Number.isFinite(price) || Math.abs(price - parsed / 100) >= 1e-8) return null
  }
  return parsed
}

function isExcludedLine(item: Record<string, unknown>): boolean {
  return item.isGift === true
    || item.isShipping === true
    || item.type === 'shipping'
    || item.kind === 'shipping'
    || item.kind === 'gift'
    || item.lineType === 'shipping'
    || item.lineType === 'gift'
}

/**
 * Parses the server-generated checkout line metadata. The current checkout
 * format stores `price` in euros; `priceCents` is also accepted for a future
 * integer-cent format. Shipping and gift markers are never commissionable.
 */
export function parseAffiliateItemsJson(value: unknown): ParsedAffiliateItems | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 25_000) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_CHECKOUT_ITEMS) return null

  const items: AffiliateMetadataItem[] = []
  let eligibleAmountCents = 0
  let productLineCount = 0

  for (const rawItem of parsed) {
    if (!isPlainObject(rawItem)) return null
    const qty = boundedInteger(rawItem.qty, 0, MAX_ITEM_QUANTITY)
    const priceCents = parsePriceCents(rawItem)
    if (qty === null || priceCents === null) return null

    const excluded = isExcludedLine(rawItem)
    if (!excluded) {
      if (typeof rawItem.sku !== 'string' || rawItem.sku.trim().length === 0 || rawItem.sku.length > 100) return null
      productLineCount += 1
      const lineTotal = priceCents * qty
      if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(eligibleAmountCents + lineTotal)) return null
      eligibleAmountCents += lineTotal
      if (eligibleAmountCents > MAX_CART_SUBTOTAL_CENTS) return null
    }

    items.push({ priceCents, qty, excluded })
  }

  return productLineCount > 0 ? { items, eligibleAmountCents } : null
}

export function parseAffiliateCheckoutMetadata(args: {
  promoCode: unknown
  itemsJson: unknown
  amountTotalCents: unknown
}): { code: string; eligibleAmountCents: number } | null {
  const code = normalizePromoCode(args.promoCode)
  if (!code) return null
  const amountTotalCents = boundedInteger(args.amountTotalCents, 0, MAX_SESSION_AMOUNT_CENTS)
  if (amountTotalCents === null) return null

  const items = parseAffiliateItemsJson(args.itemsJson)
  if (!items || items.eligibleAmountCents > amountTotalCents) return null
  return { code, eligibleAmountCents: items.eligibleAmountCents }
}

export function calculateAffiliateRateBps(cumulativeEligibleAmountCents: number, config: AffiliateRateConfig): number | null {
  if (boundedInteger(cumulativeEligibleAmountCents, 0, Number.MAX_SAFE_INTEGER) === null) return null
  if (
    boundedInteger(config.baseRateBps, 0, 10_000) === null
    || boundedInteger(config.stepRateBps, 0, 10_000) === null
    || boundedInteger(config.thresholdCents, 1, Number.MAX_SAFE_INTEGER) === null
    || boundedInteger(config.maxRateBps, 0, 10_000) === null
  ) return null

  const stepCount = BigInt(cumulativeEligibleAmountCents) / BigInt(config.thresholdCents)
  const calculatedRate = BigInt(config.baseRateBps) + stepCount * BigInt(config.stepRateBps)
  const cappedRate = calculatedRate < BigInt(config.maxRateBps)
    ? calculatedRate
    : BigInt(config.maxRateBps)
  const result = Number(cappedRate)
  return Number.isSafeInteger(result) && result >= 0 && result <= 10_000 ? result : null
}

/**
 * Commission uses integer cents and round-half-up: (amount * bps + 5,000) /
 * 10,000, truncated with BigInt arithmetic. This is deterministic and cannot
 * overflow JavaScript's safe integer range before the final validation.
 */
export function calculateAffiliateCommissionCents(eligibleAmountCents: number, rateBps: number): number | null {
  if (boundedInteger(eligibleAmountCents, 0, MAX_CART_SUBTOTAL_CENTS) === null) return null
  if (boundedInteger(rateBps, 0, 10_000) === null) return null

  const commission = (BigInt(eligibleAmountCents) * BigInt(rateBps) + BigInt(5_000)) / BigInt(10_000)
  const result = Number(commission)
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}

function validPromoCodeRecord(record: AffiliatePromoCodeRecord, code: string): CmsId | null {
  const id = safeId(record.id)
  const recordCode = normalizePromoCode(record.code)
  return id !== null
    && recordCode === code
    && (record.active === true || record.active === false)
    && record.type === 'percent'
    ? id
    : null
}

function validAffiliateRecord(record: AffiliateRecord, promoCodeId: CmsId): {
  id: CmsId
  slug: string
  config: AffiliateRateConfig
} | null {
  const id = safeId(record.id)
  const slug = typeof record.slug === 'string' ? record.slug : null
  const relatedPromoCodeId = relationId(record.promoCode)
  const baseRateBps = boundedInteger(record.commissionBaseRateBps, 0, 10_000)
  const stepRateBps = boundedInteger(record.commissionStepRateBps, 0, 10_000)
  const thresholdCents = boundedInteger(record.commissionStepThresholdCents, 1, Number.MAX_SAFE_INTEGER)
  const maxRateBps = boundedInteger(record.commissionMaxRateBps, 0, 10_000)

  if (
    id === null
    || slug === null
    || slug.length > MAX_SLUG_LENGTH
    || !AFFILIATE_SLUG_RE.test(slug)
    || (record.status !== 'active' && record.status !== 'paused' && record.status !== 'archived')
    || relatedPromoCodeId === null
    || String(relatedPromoCodeId) !== String(promoCodeId)
    || baseRateBps === null
    || stepRateBps === null
    || thresholdCents === null
    || maxRateBps === null
  ) return null

  return {
    id,
    slug,
    config: { baseRateBps, stepRateBps, thresholdCents, maxRateBps },
  }
}

function validPaymentIntentId(value: unknown): string | undefined {
  const candidate = isPlainObject(value) && 'id' in value ? value.id : value
  return typeof candidate === 'string' && /^pi_[A-Za-z0-9_]+$/.test(candidate) && candidate.length <= 128
    ? candidate
    : undefined
}

function paymentIntentId(session: Stripe.Checkout.Session): string | undefined {
  const paymentIntent = session.payment_intent
  return validPaymentIntentId(paymentIntent)
}

function validConversionState(conversion: AffiliateConversionRecord): boolean {
  const amountRefundedCents = boundedInteger(conversion.amountRefundedCents, 0, MAX_SESSION_AMOUNT_CENTS)
  const commissionAmountCents = boundedInteger(conversion.commissionAmountCents, 0, Number.MAX_SAFE_INTEGER)
  if (amountRefundedCents === null || commissionAmountCents === null) return false

  if (conversion.paymentStatus === 'paid') {
    return conversion.refundStatus === 'none' && amountRefundedCents === 0
  }
  if (conversion.paymentStatus === 'partially_refunded') {
    return conversion.refundStatus === 'partial' && amountRefundedCents > 0
  }
  if (conversion.paymentStatus === 'refunded') {
    return conversion.refundStatus === 'full' && amountRefundedCents > 0 && commissionAmountCents === 0
  }
  return false
}

function sameCmsId(left: unknown, right: CmsId): boolean {
  const leftId = relationId(left)
  return leftId !== null && String(leftId) === String(right)
}

function conversionMatchesSession(
  conversion: AffiliateConversionRecord,
  expected: {
    stripeSessionId: string
    stripePaymentIntentId?: string
    orderNumber: string
    promoCodeSnapshot: string
    eligibleAmountCents: number
    affiliateId?: CmsId
    affiliateSlugSnapshot?: string
  },
): boolean {
  const isFullyRefunded = conversion.paymentStatus === 'refunded' && conversion.refundStatus === 'full'
  const isValidPaymentState = isFullyRefunded
    || (conversion.paymentStatus === 'paid' && conversion.refundStatus === 'none')
    || (conversion.paymentStatus === 'partially_refunded' && conversion.refundStatus === 'partial')
  const storedRate = boundedInteger(conversion.commissionRateBps, 0, 10_000)
  const storedCommission = boundedInteger(conversion.commissionAmountCents, 0, Number.MAX_SAFE_INTEGER)
  const storedEligibleAmount = boundedInteger(conversion.eligibleAmountCents, 0, MAX_CART_SUBTOTAL_CENTS)
  const storedPaymentIntentId = validPaymentIntentId(conversion.stripePaymentIntentId)
  const storedAffiliateSlug = typeof conversion.affiliateSlugSnapshot === 'string'
    && conversion.affiliateSlugSnapshot.length <= MAX_SLUG_LENGTH
    && AFFILIATE_SLUG_RE.test(conversion.affiliateSlugSnapshot)
  const storedCommissionCheck = storedEligibleAmount === null || storedRate === null
    ? null
    : calculateAffiliateCommissionCents(storedEligibleAmount, storedRate)

  return validConversionState(conversion)
    && conversion.stripeSessionId === expected.stripeSessionId
    && conversion.orderNumber === expected.orderNumber
    && conversion.currency === 'EUR'
    && isValidPaymentState
    && conversion.promoCodeSnapshot === expected.promoCodeSnapshot
    && storedAffiliateSlug
    && storedEligibleAmount === expected.eligibleAmountCents
    && storedRate !== null
    && storedCommission !== null
    && (isFullyRefunded ? storedCommission === 0 : storedCommissionCheck === storedCommission)
    && (expected.stripePaymentIntentId === undefined || storedPaymentIntentId === expected.stripePaymentIntentId)
    && (expected.affiliateId === undefined || sameCmsId(conversion.affiliate, expected.affiliateId))
    && (expected.affiliateSlugSnapshot === undefined || conversion.affiliateSlugSnapshot === expected.affiliateSlugSnapshot)
}

function assertConversionConsistency(
  conversion: AffiliateConversionRecord,
  expected: Parameters<typeof conversionMatchesSession>[1],
): void {
  if (!conversionMatchesSession(conversion, expected)) throw new AffiliateAttributionError('ledger_inconsistent')
}

export async function attributePaidCheckout(args: {
  session: Stripe.Checkout.Session
  orderNumber: string
  cms: AffiliateAttributionCms
  now?: Date
}): Promise<{ status: 'none' } | {
  status: 'attributed'
  eligibleAmountCents: number
  commissionRateBps: number
  commissionAmountCents: number
}> {
  if (args.session.mode !== 'payment' || args.session.payment_status !== 'paid') return { status: 'none' }
  const rawPromoCode = args.session.metadata?.promo_code
  if (rawPromoCode === undefined || rawPromoCode === null || rawPromoCode === '') return { status: 'none' }

  const normalizedPromoCode = normalizePromoCode(rawPromoCode)
  const rawAffiliateMarker = args.session.metadata?.affiliate_promo_code
  if (rawAffiliateMarker === undefined || rawAffiliateMarker === null || rawAffiliateMarker === '') return { status: 'none' }
  const affiliateMarker = normalizePromoCode(rawAffiliateMarker)
  if (!normalizedPromoCode || !affiliateMarker || affiliateMarker !== normalizedPromoCode) throw new AffiliateAttributionError('metadata_invalid')

  const metadata = parseAffiliateCheckoutMetadata({
    promoCode: rawPromoCode,
    itemsJson: args.session.metadata?.items_json,
    amountTotalCents: args.session.amount_total,
  })
  if (!metadata) throw new AffiliateAttributionError('metadata_invalid')
  if ((args.session.currency ?? '').toLowerCase() !== 'eur') throw new AffiliateAttributionError('metadata_invalid')

  let existingConversion: AffiliateConversionRecord | null
  try {
    existingConversion = await args.cms.findConversionByStripeSessionId(args.session.id)
  } catch {
    throw new AffiliateAttributionError('ledger_lookup_failed')
  }

  const rawAffiliateIdMarker = args.session.metadata?.affiliate_id
  const rawAffiliateSlugMarker = args.session.metadata?.affiliate_slug
  const affiliateIdMarker = safeId(rawAffiliateIdMarker)
  const affiliateSlugMarker = typeof rawAffiliateSlugMarker === 'string' && AFFILIATE_SLUG_RE.test(rawAffiliateSlugMarker)
    ? rawAffiliateSlugMarker
    : null
  if (affiliateIdMarker === null || affiliateSlugMarker === null || affiliateMarker !== normalizedPromoCode) {
    throw new AffiliateAttributionError('metadata_invalid')
  }

  const stripePaymentIntentId = paymentIntentId(args.session)
  if (stripePaymentIntentId === undefined) throw new AffiliateAttributionError('metadata_invalid')

  if (existingConversion) {
    const storedRate = boundedInteger(existingConversion.commissionRateBps, 0, 10_000)
    const storedCommission = boundedInteger(existingConversion.commissionAmountCents, 0, Number.MAX_SAFE_INTEGER)
    const storedEligibleAmount = boundedInteger(existingConversion.eligibleAmountCents, 0, MAX_CART_SUBTOTAL_CENTS)
    const isFullyRefunded = existingConversion.paymentStatus === 'refunded' && existingConversion.refundStatus === 'full'
    if (
      storedRate === null
      || storedCommission === null
      || storedEligibleAmount === null
      || (!isFullyRefunded && calculateAffiliateCommissionCents(storedEligibleAmount, storedRate) !== storedCommission)
    ) throw new AffiliateAttributionError('ledger_inconsistent')

    assertConversionConsistency(existingConversion, {
      stripeSessionId: args.session.id,
      stripePaymentIntentId,
      orderNumber: args.orderNumber,
      promoCodeSnapshot: metadata.code,
      eligibleAmountCents: metadata.eligibleAmountCents,
      affiliateId: affiliateIdMarker,
      affiliateSlugSnapshot: affiliateSlugMarker,
    })

    if (isFullyRefunded) {
      return {
        status: 'attributed',
        eligibleAmountCents: storedEligibleAmount,
        commissionRateBps: storedRate,
        commissionAmountCents: 0,
      }
    }

    const storedPromoCode = typeof existingConversion.promoCodeSnapshot === 'string' ? existingConversion.promoCodeSnapshot : null
    const storedAffiliateSlug = typeof existingConversion.affiliateSlugSnapshot === 'string' ? existingConversion.affiliateSlugSnapshot : null
    if (storedPromoCode === null || storedAffiliateSlug === null) throw new AffiliateAttributionError('ledger_inconsistent')
    try {
      await args.cms.patchOrderByNumber(args.orderNumber, {
        affiliatePromoCode: storedPromoCode,
        affiliateSlug: storedAffiliateSlug,
        affiliateEligibleAmountCents: storedEligibleAmount,
        affiliateCommissionRateBps: storedRate,
        affiliateCommissionCents: storedCommission,
      }, args.session.id, stripePaymentIntentId)
    } catch {
      throw new AffiliateAttributionError('order_patch_failed')
    }

    return {
      status: 'attributed',
      eligibleAmountCents: storedEligibleAmount,
      commissionRateBps: storedRate,
      commissionAmountCents: storedCommission,
    }
  }

  let promoCodes: AffiliatePromoCodeRecord[]
  try {
    promoCodes = await args.cms.findPromoCodesByExactCode(metadata.code)
  } catch {
    throw new AffiliateAttributionError('promo_lookup_failed')
  }
  if (promoCodes.length === 0) throw new AffiliateAttributionError('promo_missing')
  if (promoCodes.length !== 1) throw new AffiliateAttributionError('promo_ambiguous')
  const promoCodeId = validPromoCodeRecord(promoCodes[0]!, metadata.code)
  if (promoCodeId === null) throw new AffiliateAttributionError('promo_invalid')

  let affiliates: AffiliateRecord[]
  try {
    affiliates = await args.cms.findAffiliateByIdAndPromoCode(affiliateIdMarker, promoCodeId)
  } catch {
    throw new AffiliateAttributionError('affiliate_lookup_failed')
  }
  if (affiliates.length === 0) throw new AffiliateAttributionError('affiliate_missing')
  if (affiliates.length !== 1) throw new AffiliateAttributionError('affiliate_ambiguous')
  const affiliate = validAffiliateRecord(affiliates[0]!, promoCodeId)
  if (!affiliate) throw new AffiliateAttributionError('affiliate_invalid')
  if (String(affiliate.id) !== String(affiliateIdMarker) || affiliate.slug !== affiliateSlugMarker) {
    throw new AffiliateAttributionError('affiliate_invalid')
  }

  let createdConversion: AffiliateConversionCreateResult
  try {
    createdConversion = await args.cms.createOrGetConversion({
      stripeSessionId: args.session.id,
      stripePaymentIntentId,
      orderNumber: args.orderNumber,
      affiliate: affiliate.id,
      promoCodeSnapshot: metadata.code,
      affiliateSlugSnapshot: affiliate.slug,
      eligibleAmountCents: metadata.eligibleAmountCents,
      currency: 'EUR',
      paidAt: (args.now ?? new Date()).toISOString(),
    })
  } catch {
    throw new AffiliateAttributionError('ledger_write_failed')
  }

  const canonicalConversion = createdConversion as AffiliateConversionRecord
  assertConversionConsistency(canonicalConversion, {
    stripeSessionId: args.session.id,
    stripePaymentIntentId,
    orderNumber: args.orderNumber,
    promoCodeSnapshot: metadata.code,
    eligibleAmountCents: metadata.eligibleAmountCents,
    affiliateId: affiliate.id,
    affiliateSlugSnapshot: affiliate.slug,
  })
  const canonicalRate = boundedInteger(createdConversion.commissionRateBps, 0, 10_000)
  const canonicalCommission = boundedInteger(createdConversion.commissionAmountCents, 0, Number.MAX_SAFE_INTEGER)
  const canonicalEligibleAmount = boundedInteger(createdConversion.eligibleAmountCents, 0, MAX_CART_SUBTOTAL_CENTS)
  if (canonicalRate === null || canonicalCommission === null || canonicalEligibleAmount === null) {
    throw new AffiliateAttributionError('ledger_inconsistent')
  }

  if (createdConversion.paymentStatus === 'refunded' && createdConversion.refundStatus === 'full') {
    return {
      status: 'attributed',
      eligibleAmountCents: canonicalEligibleAmount,
      commissionRateBps: canonicalRate,
      commissionAmountCents: 0,
    }
  }

  try {
    await args.cms.patchOrderByNumber(args.orderNumber, {
      affiliatePromoCode: createdConversion.promoCodeSnapshot,
      affiliateSlug: createdConversion.affiliateSlugSnapshot,
      affiliateEligibleAmountCents: canonicalEligibleAmount,
      affiliateCommissionRateBps: canonicalRate,
      affiliateCommissionCents: canonicalCommission,
    }, args.session.id, stripePaymentIntentId)
  } catch {
    throw new AffiliateAttributionError('order_patch_failed')
  }

  return {
    status: 'attributed',
    eligibleAmountCents: canonicalEligibleAmount,
    commissionRateBps: canonicalRate,
    commissionAmountCents: canonicalCommission,
  }
}

function stripePaymentIntentId(value: unknown): string | null {
  const candidate = isPlainObject(value) && 'id' in value ? value.id : value
  if (typeof candidate !== 'string') return null
  const normalized = candidate.trim()
  return /^pi_[A-Za-z0-9_]+$/.test(normalized) && normalized.length <= 128 ? normalized : null
}

function validRefundPatch(patch: AffiliateConversionPaymentStatusPatch): boolean {
  const amountRefundedCents = boundedInteger(patch.amountRefundedCents, 1, MAX_SESSION_AMOUNT_CENTS)
  if (amountRefundedCents === null) return false

  if (patch.refundStatus === 'full') {
    return patch.paymentStatus === 'refunded' && patch.commissionAmountCents === 0
  }
  return patch.refundStatus === 'partial'
    && patch.paymentStatus === 'partially_refunded'
    && patch.commissionAmountCents === undefined
}

/**
 * Validates one cumulative Stripe refund state before handing it to the CMS's
 * atomic transition. The adapter is injected so the contract can be tested
 * without a network.
 */
export async function updateConversionPaymentStatusByPaymentIntent(
  paymentIntentId: string,
  patch: AffiliateConversionPaymentStatusPatch,
  cms: AffiliateConversionPaymentStatusCms,
): Promise<AffiliateConversionPaymentStatusUpdateResult> {
  const normalizedPaymentIntentId = stripePaymentIntentId(paymentIntentId)
  if (normalizedPaymentIntentId === null || !validRefundPatch(patch)) {
    throw new Error('Invalid affiliate refund update')
  }
  return cms.updateConversionPaymentStatusByPaymentIntent(normalizedPaymentIntentId, patch)
}

export function hasAffiliateRefundMarker(charge: Pick<Stripe.Charge, 'metadata'>): boolean {
  return typeof charge.metadata?.affiliate_promo_code === 'string'
    && charge.metadata.affiliate_promo_code.trim().length > 0
}

export function mapStripeChargeRefund(charge: Pick<
  Stripe.Charge,
  'payment_intent' | 'amount' | 'amount_refunded' | 'currency' | 'refunded' | 'metadata'
>): { paymentIntentId: string; patch: AffiliateConversionPaymentStatusPatch; hasAffiliateMarker: boolean } | null {
  const paymentIntentId = stripePaymentIntentId(charge.payment_intent)
  const hasAffiliateMarker = hasAffiliateRefundMarker(charge)
  const amount = boundedInteger(charge.amount, 1, MAX_SESSION_AMOUNT_CENTS)
  const amountRefundedCents = boundedInteger(charge.amount_refunded, 0, MAX_SESSION_AMOUNT_CENTS)
  if (
    paymentIntentId === null
    || amount === null
    || amountRefundedCents === null
    || amountRefundedCents > amount
    || typeof charge.currency !== 'string'
    || charge.currency.toLowerCase() !== 'eur'
  ) return null

  if (charge.refunded === true && amountRefundedCents === amount) {
    return {
      paymentIntentId,
      hasAffiliateMarker,
      patch: {
        paymentStatus: 'refunded',
        refundStatus: 'full',
        amountRefundedCents,
        commissionAmountCents: 0,
      },
    }
  }

  if (amountRefundedCents > 0 && amountRefundedCents < amount) {
    return {
      paymentIntentId,
      hasAffiliateMarker,
      patch: {
        paymentStatus: 'partially_refunded',
        refundStatus: 'partial',
        amountRefundedCents,
      },
    }
  }

  return null
}

export async function updateAffiliateConversionForStripeChargeRefund(args: {
  charge: Pick<Stripe.Charge, 'payment_intent' | 'amount' | 'amount_refunded' | 'currency' | 'refunded' | 'metadata'>
  cms: AffiliateAttributionCms
}): Promise<AffiliateChargeRefundResult> {
  const mappedRefund = mapStripeChargeRefund(args.charge)
  if (mappedRefund === null) throw new Error('Invalid Stripe charge refund')
  if (!mappedRefund.hasAffiliateMarker) return { status: 'non_affiliate' }
  return updateConversionPaymentStatusByPaymentIntent(
    mappedRefund.paymentIntentId,
    mappedRefund.patch,
    args.cms,
  )
}

interface CmsDocsResponse {
  docs?: unknown[]
}

function cmsUrl(): string {
  return process.env.PAYLOAD_PUBLIC_URL || CMS_DEFAULT_URL
}

function cmsHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
  }
}

async function readDocs(response: Response): Promise<unknown[]> {
  if (!response.ok) throw new Error(`CMS request failed ${response.status}`)
  const data = await response.json() as CmsDocsResponse
  return Array.isArray(data.docs) ? data.docs : []
}

/** The route uses this secret-backed client; tests inject the interface above. */
export function createAffiliateAttributionCms(): AffiliateAttributionCms {
  return {
    async findPromoCodesByExactCode(code) {
      const response = await fetch(
        `${cmsUrl()}/api/promo-codes?where[code][equals]=${encodeURIComponent(code)}&depth=0&limit=2`,
        { headers: cmsHeaders(), cache: 'no-store' },
      )
      return await readDocs(response) as AffiliatePromoCodeRecord[]
    },

    async findAffiliateByIdAndPromoCode(affiliateId, promoCodeId) {
      const response = await fetch(
        `${cmsUrl()}/api/affiliates?where[id][equals]=${encodeURIComponent(String(affiliateId))}&where[promoCode][equals]=${encodeURIComponent(String(promoCodeId))}&depth=0&limit=2`,
        { headers: cmsHeaders(), cache: 'no-store' },
      )
      return await readDocs(response) as AffiliateRecord[]
    },

    async findConversionByStripeSessionId(stripeSessionId) {
      const response = await fetch(
        `${cmsUrl()}/api/affiliate-conversions?where[stripeSessionId][equals]=${encodeURIComponent(stripeSessionId)}&depth=0&limit=1`,
        { headers: cmsHeaders(), cache: 'no-store' },
      )
      const docs = await readDocs(response)
      return (docs[0] as AffiliateConversionRecord | undefined) ?? null
    },

    async createOrGetConversion(payload) {
      const response = await fetch(`${cmsUrl()}/api/affiliate-conversions/create-or-get-conversion`, {
        method: 'POST',
        headers: cmsHeaders(),
        body: JSON.stringify({
          stripeSessionId: payload.stripeSessionId,
          stripePaymentIntentId: payload.stripePaymentIntentId,
          orderNumber: payload.orderNumber,
          affiliateId: payload.affiliate,
          promoCodeSnapshot: payload.promoCodeSnapshot,
          affiliateSlugSnapshot: payload.affiliateSlugSnapshot,
          eligibleAmountCents: payload.eligibleAmountCents,
          currency: payload.currency,
          paidAt: payload.paidAt,
        }),
      })
      if (!response.ok) throw new Error(`CMS conversion create failed ${response.status}`)
      const result = await response.json() as Partial<AffiliateConversionCreateResult>
      if (
        (result.status !== 'created' && result.status !== 'existing')
        || typeof result.stripeSessionId !== 'string'
        || typeof result.stripePaymentIntentId !== 'string'
        || validPaymentIntentId(result.stripePaymentIntentId) !== result.stripePaymentIntentId
        || result.affiliate === undefined
        || typeof result.orderNumber !== 'string'
        || typeof result.promoCodeSnapshot !== 'string'
        || typeof result.affiliateSlugSnapshot !== 'string'
        || boundedInteger(result.eligibleAmountCents, 0, MAX_CART_SUBTOTAL_CENTS) === null
        || boundedInteger(result.commissionRateBps, 0, 10_000) === null
        || boundedInteger(result.commissionAmountCents, 0, Number.MAX_SAFE_INTEGER) === null
        || boundedInteger(result.amountRefundedCents, 0, MAX_SESSION_AMOUNT_CENTS) === null
        || result.currency !== 'EUR'
        || (result.paymentStatus !== 'paid' && result.paymentStatus !== 'refunded' && result.paymentStatus !== 'partially_refunded' && result.paymentStatus !== 'cancelled')
        || (result.refundStatus !== 'none' && result.refundStatus !== 'partial' && result.refundStatus !== 'full')
        || !validConversionState(result as AffiliateConversionRecord)
      ) throw new Error('CMS conversion create returned an invalid result')
      return result as AffiliateConversionCreateResult
    },

    async patchOrderByNumber(orderNumber, patch, stripeSessionId, stripePaymentIntentId) {
      const response = await fetch(`${cmsUrl()}/api/affiliate-conversions/apply-order-attribution`, {
        method: 'POST',
        headers: cmsHeaders(),
        body: JSON.stringify({
          stripeSessionId,
          stripePaymentIntentId,
          orderNumber,
          ...patch,
        }),
      })
      if (!response.ok) throw new Error(`CMS order patch failed ${response.status}`)
      const result = await response.json() as { status?: unknown }
      if (result.status !== 'patched' && result.status !== 'refunded') {
        throw new Error('CMS order attribution returned an invalid result')
      }
      return result as AffiliateOrderAttributionResult
    },

    async updateConversionPaymentStatusByPaymentIntent(stripePaymentIntentId, patch) {
      const response = await fetch(`${cmsUrl()}/api/affiliate-conversions/apply-refund-transition`, {
        method: 'POST',
        headers: cmsHeaders(),
        body: JSON.stringify({
          stripePaymentIntentId,
          amountRefundedCents: patch.amountRefundedCents,
          refundStatus: patch.refundStatus,
        }),
      })
      if (!response.ok) throw new Error(`CMS conversion payment status update failed ${response.status}`)
      const result = await response.json() as { status?: unknown }
      if (result.status === 'missing' || result.status === 'stale' || result.status === 'updated') {
        return result as AffiliateConversionPaymentStatusUpdateResult
      }
      throw new Error('CMS conversion payment status update returned an invalid result')
    },
  }
}
