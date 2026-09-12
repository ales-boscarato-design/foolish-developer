import { APIError } from 'payload'
import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import type { CollectionConfig, PayloadRequest } from 'payload'

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

function validateNonNegativeInteger(label: string, max = Number.MAX_SAFE_INTEGER) {
  return (value: unknown) => {
    if (value === null || value === undefined) return true
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
      return `${label} deve essere un intero tra 0 e ${max}`
    }
    return true
  }
}

const MAX_REFUND_AMOUNT_CENTS = 1_000_000_000
const MAX_SESSION_ID_LENGTH = 128
const MAX_ORDER_NUMBER_LENGTH = 256
const MAX_ELIGIBLE_AMOUNT_CENTS = 99_999_999
const MAX_PAID_AT_LENGTH = 64
const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/
const AFFILIATE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedInteger(value: unknown, min: number, max: number): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed) && parsed >= min && parsed <= max) return parsed
  }
  return null
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

function parseConversionCreateBody(body: unknown): {
  stripeSessionId: string
  stripePaymentIntentId: string
  orderNumber: string
  affiliateId: number
  promoCodeSnapshot: string
  affiliateSlugSnapshot: string
  eligibleAmountCents: number
  currency: 'EUR'
  paidAt: string
} {
  if (!isRecord(body)) throw new APIError('Invalid affiliate conversion', 400)

  const allowedKeys = new Set([
    'stripeSessionId',
    'stripePaymentIntentId',
    'orderNumber',
    'affiliateId',
    'promoCodeSnapshot',
    'affiliateSlugSnapshot',
    'eligibleAmountCents',
    'currency',
    'paidAt',
  ])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new APIError('Invalid affiliate conversion', 400)
  }

  const stripeSessionId = boundedString(body.stripeSessionId, MAX_SESSION_ID_LENGTH)
  const stripePaymentIntentId = boundedString(body.stripePaymentIntentId, MAX_SESSION_ID_LENGTH)
  const orderNumber = boundedString(body.orderNumber, MAX_ORDER_NUMBER_LENGTH)
  const affiliateId = boundedInteger(body.affiliateId, 1, Number.MAX_SAFE_INTEGER)
  const promoCodeSnapshot = boundedString(body.promoCodeSnapshot, 64)
  const affiliateSlugSnapshot = boundedString(body.affiliateSlugSnapshot, 63)
  const eligibleAmountCents = boundedInteger(body.eligibleAmountCents, 0, MAX_ELIGIBLE_AMOUNT_CENTS)
  const paidAt = boundedString(body.paidAt, MAX_PAID_AT_LENGTH)

  if (
    stripeSessionId === null
    || !/^cs_[A-Za-z0-9_]+$/.test(stripeSessionId)
    || stripePaymentIntentId === null
    || !/^pi_[A-Za-z0-9_]+$/.test(stripePaymentIntentId)
    || orderNumber === null
    || affiliateId === null
    || promoCodeSnapshot === null
    || !PROMO_CODE_RE.test(promoCodeSnapshot)
    || affiliateSlugSnapshot === null
    || !AFFILIATE_SLUG_RE.test(affiliateSlugSnapshot)
    || eligibleAmountCents === null
    || body.currency !== 'EUR'
    || paidAt === null
    || !Number.isFinite(Date.parse(paidAt))
  ) throw new APIError('Invalid affiliate conversion', 400)

  return {
    stripeSessionId,
    stripePaymentIntentId,
    orderNumber,
    affiliateId,
    promoCodeSnapshot,
    affiliateSlugSnapshot,
    eligibleAmountCents,
    currency: 'EUR',
    paidAt,
  }
}

function canonicalConversion(row: Record<string, unknown>): {
  id: number
  stripeSessionId: string
  stripePaymentIntentId?: string
  orderNumber: string
  affiliate: number
  promoCodeSnapshot: string
  affiliateSlugSnapshot: string
  eligibleAmountCents: number
  commissionRateBps: number
  commissionAmountCents: number
  currency: 'EUR'
  paymentStatus: 'paid' | 'refunded' | 'partially_refunded' | 'cancelled'
  refundStatus: 'none' | 'partial' | 'full'
  amountRefundedCents: number
} {
  const id = boundedInteger(row.id, 1, Number.MAX_SAFE_INTEGER)
  const stripeSessionId = boundedString(row.stripe_session_id, MAX_SESSION_ID_LENGTH)
  const stripePaymentIntentId = row.stripe_payment_intent_id === null || row.stripe_payment_intent_id === undefined
    ? undefined
    : boundedString(row.stripe_payment_intent_id, MAX_SESSION_ID_LENGTH)
  const orderNumber = boundedString(row.order_number, MAX_ORDER_NUMBER_LENGTH)
  const affiliate = boundedInteger(row.affiliate_id, 1, Number.MAX_SAFE_INTEGER)
  const promoCodeSnapshot = boundedString(row.promo_code_snapshot, 64)
  const affiliateSlugSnapshot = boundedString(row.affiliate_slug_snapshot, 63)
  const eligibleAmountCents = boundedInteger(row.eligible_amount_cents, 0, Number.MAX_SAFE_INTEGER)
  const commissionRateBps = boundedInteger(row.commission_rate_bps, 0, 10_000)
  const commissionAmountCents = boundedInteger(row.commission_amount_cents, 0, Number.MAX_SAFE_INTEGER)
  const amountRefundedCents = boundedInteger(row.amount_refunded_cents, 0, Number.MAX_SAFE_INTEGER)
  const paymentStatus = row.payment_status
  const refundStatus = row.refund_status

  if (
    id === null
    || stripeSessionId === null
    || (row.stripe_payment_intent_id !== null && row.stripe_payment_intent_id !== undefined && (typeof stripePaymentIntentId !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(stripePaymentIntentId)))
    || orderNumber === null
    || affiliate === null
    || promoCodeSnapshot === null
    || affiliateSlugSnapshot === null
    || eligibleAmountCents === null
    || commissionRateBps === null
    || commissionAmountCents === null
    || amountRefundedCents === null
    || row.currency !== 'EUR'
    || (paymentStatus !== 'paid' && paymentStatus !== 'refunded' && paymentStatus !== 'partially_refunded' && paymentStatus !== 'cancelled')
    || (refundStatus !== 'none' && refundStatus !== 'partial' && refundStatus !== 'full')
  ) throw new APIError('Malformed affiliate conversion', 500)

  return {
    id,
    stripeSessionId,
    ...(stripePaymentIntentId ? { stripePaymentIntentId } : {}),
    orderNumber,
    affiliate,
    promoCodeSnapshot,
    affiliateSlugSnapshot,
    eligibleAmountCents,
    commissionRateBps,
    commissionAmountCents,
    currency: 'EUR',
    paymentStatus,
    refundStatus,
    amountRefundedCents,
  }
}

function validConversionState(conversion: ReturnType<typeof canonicalConversion>): boolean {
  if (conversion.paymentStatus === 'paid') {
    return conversion.refundStatus === 'none' && conversion.amountRefundedCents === 0
  }
  if (conversion.paymentStatus === 'partially_refunded') {
    return conversion.refundStatus === 'partial' && conversion.amountRefundedCents > 0
  }
  if (conversion.paymentStatus === 'refunded') {
    return conversion.refundStatus === 'full'
      && conversion.amountRefundedCents > 0
      && conversion.commissionAmountCents === 0
  }
  return false
}

const conversionColumns = sql`
  "id", "stripe_session_id", "stripe_payment_intent_id", "order_number",
  "affiliate_id", "promo_code_snapshot", "affiliate_slug_snapshot",
  "eligible_amount_cents", "commission_rate_bps", "commission_amount_cents",
  "currency", "payment_status", "refund_status", "amount_refunded_cents"
`

function canonicalExistingConversion(
  input: ReturnType<typeof parseConversionCreateBody>,
  row: Record<string, unknown>,
): ReturnType<typeof canonicalConversion> {
  const conversion = canonicalConversion(row)
  const paymentIntentMatches = conversion.stripePaymentIntentId === input.stripePaymentIntentId

  if (
    conversion.stripeSessionId !== input.stripeSessionId
    || !paymentIntentMatches
    || conversion.orderNumber !== input.orderNumber
    || String(conversion.affiliate) !== String(input.affiliateId)
    || conversion.promoCodeSnapshot !== input.promoCodeSnapshot
    || conversion.affiliateSlugSnapshot !== input.affiliateSlugSnapshot
    || conversion.eligibleAmountCents !== input.eligibleAmountCents
    || conversion.currency !== input.currency
  ) throw new APIError('Affiliate conversion idempotency mismatch', 409)

  return conversion
}

async function createOrGetConversion(req: PayloadRequest): Promise<Response> {
  if (!hasStorefrontSecret(req) && !req.user) throw new APIError('Unauthorized', 401)

  let body: unknown
  try {
    if (typeof req.json !== 'function') throw new Error('missing json parser')
    body = await req.json()
  } catch {
    throw new APIError('Invalid JSON body', 400)
  }
  const input = parseConversionCreateBody(body)
  const db = req.payload.db as unknown as PostgresAdapter

  const result = await db.drizzle.transaction(async (tx) => {
    const existing = await tx.execute(sql`
      SELECT ${conversionColumns}
      FROM "affiliate_conversions"
      WHERE "stripe_session_id" = ${input.stripeSessionId}
      FOR UPDATE
    `)
    if (existing.rows.length > 1) throw new APIError('Affiliate conversion is not unique', 500)
    if (existing.rows.length === 1) {
      return {
        status: 'existing' as const,
        conversion: canonicalExistingConversion(input, existing.rows[0] as Record<string, unknown>),
      }
    }

    const affiliateRows = await tx.execute(sql`
      SELECT
        a."id", a."slug", a."status", a."promo_code_id",
        a."commission_base_rate_bps", a."commission_step_rate_bps",
        a."commission_step_threshold_cents", a."commission_max_rate_bps",
        p."id" AS "promo_id", p."code" AS "promo_code", p."type" AS "promo_type", p."active" AS "promo_active"
      FROM "affiliates" AS a
      JOIN "promo_codes" AS p ON p."id" = a."promo_code_id"
      WHERE a."id" = ${input.affiliateId}
      FOR UPDATE OF a, p
    `)
    if (affiliateRows.rows.length !== 1) throw new APIError('Affiliate unavailable', 409)

    const affiliate = affiliateRows.rows[0] as Record<string, unknown>
    const baseRateBps = boundedInteger(affiliate.commission_base_rate_bps, 0, 10_000)
    const stepRateBps = boundedInteger(affiliate.commission_step_rate_bps, 0, 10_000)
    const thresholdCents = boundedInteger(affiliate.commission_step_threshold_cents, 1, Number.MAX_SAFE_INTEGER)
    const maxRateBps = boundedInteger(affiliate.commission_max_rate_bps, 0, 10_000)
    if (
      (affiliate.status !== 'active' && affiliate.status !== 'paused' && affiliate.status !== 'archived')
      || affiliate.promo_id === null
      || affiliate.promo_id === undefined
      || affiliate.promo_type !== 'percent'
      || affiliate.promo_code !== input.promoCodeSnapshot
      || affiliate.slug !== input.affiliateSlugSnapshot
      || baseRateBps === null
      || stepRateBps === null
      || thresholdCents === null
      || maxRateBps === null
  ) throw new APIError('Affiliate configuration unavailable', 409)

    const totalResult = await tx.execute(sql`
      SELECT COALESCE(SUM("eligible_amount_cents"), 0) AS "total"
      FROM "affiliate_conversions"
      WHERE "affiliate_id" = ${input.affiliateId}
        AND "payment_status" IN ('paid'::"enum_affiliate_conversions_payment_status", 'partially_refunded'::"enum_affiliate_conversions_payment_status")
    `)
    const priorEligibleAmountCents = boundedInteger(
      (totalResult.rows[0] as Record<string, unknown> | undefined)?.total,
      0,
      Number.MAX_SAFE_INTEGER,
    )
    if (priorEligibleAmountCents === null) throw new APIError('Affiliate conversion history is malformed', 500)

    const cumulative = BigInt(priorEligibleAmountCents) + BigInt(input.eligibleAmountCents)
    if (cumulative > BigInt(Number.MAX_SAFE_INTEGER)) throw new APIError('Affiliate conversion history is too large', 409)
    const calculatedRate = BigInt(baseRateBps) + (cumulative / BigInt(thresholdCents)) * BigInt(stepRateBps)
    const commissionRateBps = Number(calculatedRate > BigInt(maxRateBps) ? BigInt(maxRateBps) : calculatedRate)
    const commissionAmountCents = Number((BigInt(input.eligibleAmountCents) * BigInt(commissionRateBps) + 5_000n) / 10_000n)

    const inserted = await tx.execute(sql`
      INSERT INTO "affiliate_conversions" (
        "stripe_session_id", "stripe_payment_intent_id", "order_number", "affiliate_id",
        "promo_code_snapshot", "affiliate_slug_snapshot", "eligible_amount_cents",
        "commission_rate_bps", "commission_amount_cents", "currency", "payment_status",
        "refund_status", "amount_refunded_cents", "paid_at", "updated_at", "created_at"
      ) VALUES (
        ${input.stripeSessionId}, ${input.stripePaymentIntentId ?? null}, ${input.orderNumber}, ${input.affiliateId},
        ${input.promoCodeSnapshot}, ${input.affiliateSlugSnapshot}, ${input.eligibleAmountCents},
        ${commissionRateBps}, ${commissionAmountCents}, ${input.currency}, 'paid'::"enum_affiliate_conversions_payment_status",
        'none'::"enum_affiliate_conversions_refund_status", 0, ${input.paidAt}::timestamptz, NOW(), NOW()
      )
      ON CONFLICT ("stripe_session_id") DO NOTHING
      RETURNING ${conversionColumns}
    `)

    if (inserted.rows.length === 1) {
      return { status: 'created' as const, conversion: canonicalConversion(inserted.rows[0] as Record<string, unknown>) }
    }

    const raced = await tx.execute(sql`
      SELECT ${conversionColumns}
      FROM "affiliate_conversions"
      WHERE "stripe_session_id" = ${input.stripeSessionId}
      FOR UPDATE
    `)
    if (raced.rows.length !== 1) throw new APIError('Affiliate conversion was not available after conflict', 409)
    return {
      status: 'existing' as const,
      conversion: canonicalExistingConversion(input, raced.rows[0] as Record<string, unknown>),
    }
  })

  return Response.json({ status: result.status, ...result.conversion })
}

function parseOrderAttributionBody(body: unknown): {
  stripeSessionId: string
  stripePaymentIntentId: string
  orderNumber: string
  affiliatePromoCode: string
  affiliateSlug: string
  affiliateEligibleAmountCents: number
  affiliateCommissionRateBps: number
  affiliateCommissionCents: number
} {
  if (!isRecord(body)) throw new APIError('Invalid affiliate order attribution', 400)

  const allowedKeys = new Set([
    'stripeSessionId',
    'stripePaymentIntentId',
    'orderNumber',
    'affiliatePromoCode',
    'affiliateSlug',
    'affiliateEligibleAmountCents',
    'affiliateCommissionRateBps',
    'affiliateCommissionCents',
  ])
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new APIError('Invalid affiliate order attribution', 400)
  }

  const stripeSessionId = boundedString(body.stripeSessionId, MAX_SESSION_ID_LENGTH)
  const stripePaymentIntentId = boundedString(body.stripePaymentIntentId, MAX_SESSION_ID_LENGTH)
  const orderNumber = boundedString(body.orderNumber, MAX_ORDER_NUMBER_LENGTH)
  const affiliatePromoCode = boundedString(body.affiliatePromoCode, 64)
  const affiliateSlug = boundedString(body.affiliateSlug, 63)
  const affiliateEligibleAmountCents = boundedInteger(body.affiliateEligibleAmountCents, 0, MAX_ELIGIBLE_AMOUNT_CENTS)
  const affiliateCommissionRateBps = boundedInteger(body.affiliateCommissionRateBps, 0, 10_000)
  const affiliateCommissionCents = boundedInteger(body.affiliateCommissionCents, 0, Number.MAX_SAFE_INTEGER)

  if (
    stripeSessionId === null
    || !/^cs_[A-Za-z0-9_]+$/.test(stripeSessionId)
    || stripePaymentIntentId === null
    || !/^pi_[A-Za-z0-9_]+$/.test(stripePaymentIntentId)
    || orderNumber === null
    || affiliatePromoCode === null
    || !PROMO_CODE_RE.test(affiliatePromoCode)
    || affiliateSlug === null
    || !AFFILIATE_SLUG_RE.test(affiliateSlug)
    || affiliateEligibleAmountCents === null
    || affiliateCommissionRateBps === null
    || affiliateCommissionCents === null
  ) throw new APIError('Invalid affiliate order attribution', 400)

  return {
    stripeSessionId,
    stripePaymentIntentId,
    orderNumber,
    affiliatePromoCode,
    affiliateSlug,
    affiliateEligibleAmountCents,
    affiliateCommissionRateBps,
    affiliateCommissionCents,
  }
}

export async function applyOrderAttribution(req: PayloadRequest): Promise<Response> {
  if (!hasStorefrontSecret(req) && !req.user) throw new APIError('Unauthorized', 401)

  let body: unknown
  try {
    if (typeof req.json !== 'function') throw new Error('missing json parser')
    body = await req.json()
  } catch {
    throw new APIError('Invalid JSON body', 400)
  }
  const input = parseOrderAttributionBody(body)
  const db = req.payload.db as unknown as PostgresAdapter

  const result = await db.drizzle.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT ${conversionColumns}
      FROM "affiliate_conversions"
      WHERE "stripe_session_id" = ${input.stripeSessionId}
      FOR UPDATE
    `)

    if (locked.rows.length === 0) return { status: 'missing' as const }
    if (locked.rows.length !== 1) throw new APIError('Affiliate conversion is not unique', 500)

    const conversion = canonicalConversion(locked.rows[0] as Record<string, unknown>)
    if (conversion.stripePaymentIntentId !== input.stripePaymentIntentId || conversion.orderNumber !== input.orderNumber) {
      throw new APIError('Affiliate order attribution identity mismatch', 409)
    }
    if (!validConversionState(conversion)) throw new APIError('Malformed affiliate conversion state', 500)
    if (conversion.paymentStatus === 'refunded' && conversion.refundStatus === 'full') {
      return { status: 'refunded' as const }
    }
    if (
      conversion.promoCodeSnapshot !== input.affiliatePromoCode
      || conversion.affiliateSlugSnapshot !== input.affiliateSlug
      || conversion.eligibleAmountCents !== input.affiliateEligibleAmountCents
      || conversion.commissionRateBps !== input.affiliateCommissionRateBps
      || conversion.commissionAmountCents !== input.affiliateCommissionCents
    ) throw new APIError('Affiliate order attribution snapshot mismatch', 409)

    const patched = await tx.execute(sql`
      UPDATE "orders"
      SET
        "affiliate_promo_code" = ${input.affiliatePromoCode},
        "affiliate_slug" = ${input.affiliateSlug},
        "affiliate_eligible_amount_cents" = ${input.affiliateEligibleAmountCents},
        "affiliate_commission_rate_bps" = ${input.affiliateCommissionRateBps},
        "affiliate_commission_cents" = ${input.affiliateCommissionCents},
        "updated_at" = NOW()
      WHERE "order_number" = ${input.orderNumber}
        AND "stripe_payment_intent_id" = ${input.stripePaymentIntentId}
      RETURNING "id"
    `)
    if (patched.rows.length !== 1) throw new APIError('Order unavailable for affiliate attribution', 409)
    return { status: 'patched' as const }
  })

  return Response.json(result)
}

function parseRefundTransitionBody(body: unknown): {
  stripePaymentIntentId: string
  amountRefundedCents: number
  refundStatus: 'partial' | 'full'
} {
  if (!isRecord(body)) throw new APIError('Invalid refund transition', 400)

  const stripePaymentIntentId = body.stripePaymentIntentId
  const amountRefundedCents = body.amountRefundedCents
  const refundStatus = body.refundStatus
  if (
    typeof stripePaymentIntentId !== 'string'
    || !/^pi_[A-Za-z0-9_]+$/.test(stripePaymentIntentId)
    || stripePaymentIntentId.length > 128
    || typeof amountRefundedCents !== 'number'
    || !Number.isSafeInteger(amountRefundedCents)
    || amountRefundedCents < 1
    || amountRefundedCents > MAX_REFUND_AMOUNT_CENTS
    || (refundStatus !== 'partial' && refundStatus !== 'full')
  ) throw new APIError('Invalid refund transition', 400)

  return { stripePaymentIntentId, amountRefundedCents, refundStatus }
}

export async function applyRefundTransition(req: PayloadRequest): Promise<Response> {
  if (!hasStorefrontSecret(req) && !req.user) throw new APIError('Unauthorized', 401)

  let body: unknown
  try {
    if (typeof req.json !== 'function') throw new Error('missing json parser')
    body = await req.json()
  } catch {
    throw new APIError('Invalid JSON body', 400)
  }
  const transition = parseRefundTransitionBody(body)
  const paymentStatus = transition.refundStatus === 'full' ? 'refunded' : 'partially_refunded'
  const db = req.payload.db as unknown as PostgresAdapter

  const result = await db.drizzle.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT "id", "stripe_payment_intent_id", "order_number", "payment_status", "refund_status", "amount_refunded_cents"
      FROM "affiliate_conversions"
      WHERE "stripe_payment_intent_id" = ${transition.stripePaymentIntentId}
      FOR UPDATE
    `)

    if (locked.rows.length === 0) return { status: 'missing' as const }
    if (locked.rows.length !== 1) throw new APIError('Affiliate conversion is not unique', 500)

    const current = locked.rows[0] as {
      id?: unknown
      stripe_payment_intent_id?: unknown
      order_number?: unknown
      payment_status?: unknown
      refund_status?: unknown
      amount_refunded_cents?: unknown
    }
    const currentAmount = Number(current.amount_refunded_cents)
    if (
      !Number.isSafeInteger(current.id)
      || current.stripe_payment_intent_id !== transition.stripePaymentIntentId
      || !Number.isSafeInteger(currentAmount)
      || currentAmount < 0
      || currentAmount > MAX_REFUND_AMOUNT_CENTS
    ) throw new APIError('Malformed affiliate conversion', 500)

    const currentStateIsEligible = (
      current.payment_status === 'paid'
      && current.refund_status === 'none'
      && currentAmount === 0
    ) || (
      current.payment_status === 'partially_refunded'
      && current.refund_status === 'partial'
      && currentAmount > 0
    )
    if (!currentStateIsEligible) throw new APIError('Malformed affiliate conversion state', 500)

    if (transition.amountRefundedCents <= currentAmount) {
      return { status: 'stale' as const }
    }

    const updated = await tx.execute(sql`
      UPDATE "affiliate_conversions"
      SET
        "payment_status" = ${paymentStatus}::"enum_affiliate_conversions_payment_status",
        "refund_status" = ${transition.refundStatus}::"enum_affiliate_conversions_refund_status",
        "amount_refunded_cents" = ${transition.amountRefundedCents},
        "commission_amount_cents" = CASE
          WHEN ${transition.refundStatus} = 'full' THEN 0
          ELSE "commission_amount_cents"
        END,
        "refunded_at" = COALESCE("refunded_at", NOW()),
        "updated_at" = NOW()
      WHERE "id" = ${current.id}
        AND "stripe_payment_intent_id" = ${transition.stripePaymentIntentId}
        AND "refund_status" <> 'full'
        AND "amount_refunded_cents" < ${transition.amountRefundedCents}
      RETURNING "id"
    `)

    if (updated.rows.length === 1 && transition.refundStatus === 'full') {
      const orderNumber = boundedString(current.order_number, MAX_ORDER_NUMBER_LENGTH)
      if (orderNumber === null) throw new APIError('Malformed affiliate conversion', 500)

      const zeroedOrder = await tx.execute(sql`
        UPDATE "orders"
        SET "affiliate_commission_cents" = 0, "updated_at" = NOW()
        WHERE "order_number" = ${orderNumber}
          AND "stripe_payment_intent_id" = ${transition.stripePaymentIntentId}
        RETURNING "id"
      `)
      if (zeroedOrder.rows.length !== 1) throw new APIError('Order unavailable for affiliate refund', 409)
    }

    return updated.rows.length === 1
      ? { status: 'updated' as const }
      : { status: 'stale' as const }
  })

  return Response.json(result)
}

export const AffiliateConversions: CollectionConfig = {
  slug: 'affiliate-conversions',
  endpoints: [
    {
      path: '/create-or-get-conversion',
      method: 'post',
      handler: createOrGetConversion,
    },
    {
      path: '/apply-order-attribution',
      method: 'post',
      handler: applyOrderAttribution,
    },
    {
      path: '/apply-refund-transition',
      method: 'post',
      handler: applyRefundTransition,
    },
  ],
  admin: {
    useAsTitle: 'stripeSessionId',
    defaultColumns: ['stripeSessionId', 'affiliate', 'eligibleAmountCents', 'commissionAmountCents', 'paymentStatus', 'createdAt'],
    listSearchableFields: ['stripeSessionId', 'stripePaymentIntentId', 'orderNumber', 'promoCodeSnapshot', 'affiliateSlugSnapshot'],
    group: 'Marketing',
  },
  access: {
    // Conversion and refund data is not public; admins and trusted server
    // integrations may read it through the shared secret.
    read: ({ req }) => !!req.user || hasStorefrontSecret(req),
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'stripeSessionId',
      type: 'text',
      required: true,
      unique: true,
      label: 'Stripe Checkout Session ID',
    },
    {
      name: 'stripePaymentIntentId',
      type: 'text',
      label: 'Stripe PaymentIntent ID',
      validate: (value: unknown) => value == null || (typeof value === 'string' && /^pi_[A-Za-z0-9_]+$/.test(value) && value.length <= MAX_SESSION_ID_LENGTH) || 'Il PaymentIntent Stripe non è valido',
    },
    {
      name: 'orderNumber',
      type: 'text',
      label: 'Numero ordine',
    },
    {
      name: 'affiliate',
      type: 'relationship',
      relationTo: 'affiliates',
      required: true,
      label: 'Affiliato',
    },
    {
      name: 'promoCodeSnapshot',
      type: 'text',
      required: true,
      label: 'Snapshot codice promo',
      maxLength: 64,
      validate: (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) || 'Lo snapshot del codice promo non è valido',
    },
    {
      name: 'affiliateSlugSnapshot',
      type: 'text',
      required: true,
      label: 'Snapshot slug affiliato',
      validate: (value: unknown) => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) || 'Lo snapshot dello slug affiliato non è valido',
    },
    {
      name: 'eligibleAmountCents',
      type: 'number',
      required: true,
      label: 'Importo eleggibile (centesimi)',
      validate: validateNonNegativeInteger('L’importo eleggibile', Number.MAX_SAFE_INTEGER),
    },
    {
      name: 'commissionRateBps',
      type: 'number',
      required: true,
      label: 'Aliquota commissione (bps)',
      validate: validateNonNegativeInteger('L’aliquota commissione', 10000),
    },
    {
      name: 'commissionAmountCents',
      type: 'number',
      required: true,
      label: 'Commissione (centesimi)',
      validate: validateNonNegativeInteger('La commissione', Number.MAX_SAFE_INTEGER),
    },
    {
      name: 'currency',
      type: 'text',
      required: true,
      defaultValue: 'EUR',
      label: 'Valuta',
      validate: (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value) || 'La valuta deve essere un codice ISO 4217 maiuscolo di 3 lettere',
    },
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      label: 'Stato pagamento',
      options: [
        { label: 'Pagato', value: 'paid' },
        { label: 'Rimborsato', value: 'refunded' },
        { label: 'Rimborsato parzialmente', value: 'partially_refunded' },
        { label: 'Annullato', value: 'cancelled' },
      ],
    },
    {
      name: 'refundStatus',
      type: 'select',
      required: true,
      defaultValue: 'none',
      label: 'Stato rimborso',
      options: [
        { label: 'Nessuno', value: 'none' },
        { label: 'Parziale', value: 'partial' },
        { label: 'Completo', value: 'full' },
      ],
    },
    {
      name: 'amountRefundedCents',
      type: 'number',
      required: true,
      defaultValue: 0,
      label: 'Importo rimborsato (centesimi)',
      validate: validateNonNegativeInteger('L’importo rimborsato', Number.MAX_SAFE_INTEGER),
    },
    {
      type: 'row',
      fields: [
        { name: 'paidAt', type: 'date', label: 'Pagato il', admin: { width: '50%' } },
        { name: 'refundedAt', type: 'date', label: 'Rimborsato il', admin: { width: '50%' } },
      ],
    },
  ],
  timestamps: true,
}
