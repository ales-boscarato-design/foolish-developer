import { normalizePromoCode, type PromoRecord } from './promo'

type CmsId = string | number

export interface AffiliateCheckoutMarker {
  affiliateId: CmsId
  affiliateSlug: string
  affiliatePromoCode: string
}

const CMS_DEFAULT_URL = 'https://cms-production-1e56.up.railway.app'
const AFFILIATE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function safeCmsId(value: unknown): CmsId | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 1 ? value : null
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized.length > 0 && normalized.length <= 128 ? normalized : null
  }
  return null
}

function relationId(value: unknown): CmsId | null {
  if (isPlainObject(value) && 'id' in value) return safeCmsId(value.id)
  return safeCmsId(value)
}

function affiliatePromoId(record: PromoRecord | null | undefined): CmsId | null {
  if (!record || record.type !== 'percent' || record.active !== true) return null
  return safeCmsId(record.id)
}

function resolveAffiliateCheckoutMarker(
  record: PromoRecord | null | undefined,
  affiliateDocs: unknown,
): AffiliateCheckoutMarker | null {
  const promoId = affiliatePromoId(record)
  const promoCode = normalizePromoCode(record?.code)
  if (promoId === null || promoCode === null || !Array.isArray(affiliateDocs) || affiliateDocs.length !== 1) return null

  const affiliate = affiliateDocs[0]
  if (!isPlainObject(affiliate)) return null

  const affiliateId = safeCmsId(affiliate.id)
  const affiliateSlug = typeof affiliate.slug === 'string' && AFFILIATE_SLUG_RE.test(affiliate.slug)
    ? affiliate.slug
    : null
  const relatedPromoId = relationId(affiliate.promoCode)
  if (
    affiliate.status !== 'active'
    || affiliateId === null
    || affiliateSlug === null
    || relatedPromoId === null
    || String(relatedPromoId) !== String(promoId)
  ) return null

  return { affiliateId, affiliateSlug, affiliatePromoCode: promoCode }
}

/** Pure fail-closed decision used after the protected CMS query. */
export function isAffiliateCheckoutPromo(
  record: PromoRecord | null | undefined,
  affiliateDocs: unknown,
): boolean {
  const promoId = affiliatePromoId(record)
  return promoId !== null && resolveAffiliateCheckoutMarker(record, affiliateDocs) !== null
}

/**
 * Resolves the server-generated checkout marker. Any missing configuration,
 * CMS error, or unexpected response fails closed.
 */
export async function shouldMarkAffiliateCheckoutPromo(
  record: PromoRecord | null | undefined,
): Promise<AffiliateCheckoutMarker | null> {
  const promoId = affiliatePromoId(record)
  const secret = process.env.PAYLOAD_API_SECRET
  if (promoId === null || !secret) return null

  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || CMS_DEFAULT_URL
  try {
    const response = await fetch(
      `${cmsUrl}/api/affiliates?where[promoCode][equals]=${encodeURIComponent(String(promoId))}&where[status][equals]=active&depth=0&limit=2`,
      {
        headers: { 'x-storefront-secret': secret },
        cache: 'no-store',
      },
    )
    if (!response.ok) return null

    const data = await response.json() as { docs?: unknown }
    return resolveAffiliateCheckoutMarker(record, data.docs)
  } catch {
    return null
  }
}
