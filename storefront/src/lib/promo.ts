import {
  calculateShipping,
  isAllowedShippingCountry,
  type AllowedShippingCountry,
} from './shipping'

export type PromoType = 'free_shipping' | 'percent_pro' | 'percent' | 'amount'

export interface PromoRecord {
  id?: unknown
  code?: unknown
  type?: unknown
  active?: unknown
  discountPercent?: unknown
  discountAmount?: unknown
  expiresAt?: unknown
}

export interface CheckoutCartItem {
  productName: string
  variantLabel: string
  price: number
  quantity: number
  sku: string
}

export interface CheckoutCustomer {
  email: string
  name: string
  country: AllowedShippingCountry
  address: string
  city: string
  postalCode: string
  phone: string
}

export interface ChargedProductLine {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
  unitAmountCents: number
}

export interface ValidatedPromo {
  code: string
  type: PromoType
  discountAmountCents: number
  discountPercent?: number
  freeShipping: boolean
  label: string
}

export type CheckoutPromoResult =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'valid'; promo: ValidatedPromo; cartSubtotalCents: number }

const PROMO_CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,63}$/
export const MAX_CHECKOUT_ITEMS = 50
export const MAX_ITEM_QUANTITY = 100
export const MAX_ITEM_PRICE_CENTS = 99_999_999
export const MAX_CART_SUBTOTAL_CENTS = 99_999_999
export const MAX_STRIPE_METADATA_KEY_LENGTH = 40
export const MAX_STRIPE_METADATA_VALUE_LENGTH = 500

const CUSTOMER_FIELD_LIMITS = {
  email: 254,
  name: 120,
  address: 180,
  city: 100,
  postalCode: 32,
  phone: 40,
} as const

const ITEM_FIELD_LIMITS = {
  productName: 120,
  variantLabel: 80,
  sku: 100,
} as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

export function normalizePromoCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return PROMO_CODE_RE.test(code) ? code : null
}

export function parsePromoCodes(value: unknown): Record<string, string> {
  if (typeof value !== 'string') return {}

  try {
    const parsed: unknown = JSON.parse(value)
    if (!isPlainObject(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

export function moneyToCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const cents = Math.round(value * 100)
  return Number.isSafeInteger(cents) ? cents : null
}

export function formatCents(cents: number): string {
  return (cents / 100).toFixed(2)
}

export function normalizeCheckoutCustomer(value: unknown): CheckoutCustomer | null {
  if (!isPlainObject(value)) return null

  const email = boundedString(value.email, CUSTOMER_FIELD_LIMITS.email)
  const name = boundedString(value.name, CUSTOMER_FIELD_LIMITS.name)
  const countryValue = boundedString(value.country, 2)
  const address = boundedString(value.address, CUSTOMER_FIELD_LIMITS.address)
  const city = boundedString(value.city, CUSTOMER_FIELD_LIMITS.city)
  const postalCode = boundedString(value.postalCode, CUSTOMER_FIELD_LIMITS.postalCode)
  const phone = value.phone === undefined ? '' : boundedString(value.phone, CUSTOMER_FIELD_LIMITS.phone)

  const normalizedCountry = countryValue?.toUpperCase()
  if (
    !email
    || !name
    || !normalizedCountry
    || !isAllowedShippingCountry(normalizedCountry)
    || !address
    || !city
    || !postalCode
    || phone === null
  ) {
    return null
  }

  return {
    email,
    name,
    country: normalizedCountry,
    address,
    city,
    postalCode,
    phone,
  }
}

export function normalizeCheckoutItems(items: unknown): CheckoutCartItem[] | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_CHECKOUT_ITEMS) return null

  const normalizedItems: CheckoutCartItem[] = []
  let subtotalCents = 0
  for (const item of items) {
    if (!isPlainObject(item)) return null

    const candidate = item as {
      productName?: unknown
      variantLabel?: unknown
      price?: unknown
      quantity?: unknown
      sku?: unknown
    }
    const priceCents = moneyToCents(candidate.price)
    const quantity = candidate.quantity
    if (
      typeof candidate.productName !== 'string'
      || typeof candidate.variantLabel !== 'string'
      || typeof candidate.sku !== 'string'
      || candidate.productName.trim().length === 0
      || candidate.productName.length > ITEM_FIELD_LIMITS.productName
      || candidate.variantLabel.trim().length === 0
      || candidate.variantLabel.length > ITEM_FIELD_LIMITS.variantLabel
      || candidate.sku.trim().length === 0
      || candidate.sku.length > ITEM_FIELD_LIMITS.sku
      || priceCents === null
      || priceCents <= 0
      || priceCents > MAX_ITEM_PRICE_CENTS
      || typeof quantity !== 'number'
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
      || quantity > MAX_ITEM_QUANTITY
    ) return null

    const lineCents = priceCents * quantity
    if (
      !Number.isSafeInteger(lineCents)
      || !Number.isSafeInteger(subtotalCents + lineCents)
      || subtotalCents + lineCents > MAX_CART_SUBTOTAL_CENTS
    ) return null
    subtotalCents += lineCents
    normalizedItems.push({
      productName: candidate.productName.trim(),
      variantLabel: candidate.variantLabel.trim(),
      price: priceCents / 100,
      quantity,
      sku: candidate.sku.trim(),
    })
  }

  return subtotalCents > 0 ? normalizedItems : null
}

export function cartSubtotalCents(items: unknown): number | null {
  const normalizedItems = normalizeCheckoutItems(items)
  if (!normalizedItems) return null

  return normalizedItems.reduce((subtotalCents, item) => {
    const priceCents = moneyToCents(item.price)!
    return subtotalCents + priceCents * item.quantity
  }, 0)
}

export function calculateServerShippingCostCents(
  items: unknown,
  country: unknown,
  freeShipping: boolean,
): number | null {
  const normalizedItems = normalizeCheckoutItems(items)
  const normalizedCountry = boundedString(country, 2)
  if (!normalizedItems || !normalizedCountry) return null

  const uppercaseCountry = normalizedCountry.toUpperCase()
  if (!isAllowedShippingCountry(uppercaseCountry)) return null

  const subtotalCents = cartSubtotalCents(normalizedItems)
  if (subtotalCents === null) return null

  const baseShipping = calculateShipping(subtotalCents / 100, uppercaseCountry)

  // Destinazione senza misura: non esiste un prezzo da addebitare. Mai 0 —
  // zero vorrebbe dire velocizzare a spese di Foolish. Il chiamante la tratta
  // come preventivo (vedi shippingRequiresQuote).
  if (baseShipping.requiresQuote) return null

  const baseShippingCostCents = moneyToCents(baseShipping.cost)
  if (baseShippingCostCents === null) return null

  // La promo "spedizione gratuita" azzera la tariffa solo dove la tariffa e'
  // il solo trasporto. Su una destinazione extra-UE azzererebbe anche dazi,
  // IVA all'importazione e fee DDP: li' la promo non si applica e il costo
  // sdoganato resta intero.
  const freeShippingApplied = freeShipping && baseShipping.freeShippingPromoAllowed
  return freeShippingApplied ? 0 : baseShippingCostCents
}

function isExpired(expiresAt: unknown, now: Date): boolean {
  if (expiresAt === null || expiresAt === undefined || expiresAt === '') return false
  if (typeof expiresAt !== 'string' && !(expiresAt instanceof Date)) return true

  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return Number.isNaN(expiry.getTime()) || expiry.getTime() <= now.getTime()
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function makeLabel(type: PromoType, discountPercent?: number): string {
  if (type === 'free_shipping') return 'Spedizione gratuita'
  if (type === 'percent_pro') return `Sconto Foolish Pro ${discountPercent}%`
  if (type === 'percent') return `Sconto ${discountPercent}%`
  return 'Sconto promozionale'
}

export function calculatePromoDiscount(
  code: string,
  record: PromoRecord,
  cartSubtotalCents: number,
  now = new Date(),
): ValidatedPromo | null {
  const normalizedCode = normalizePromoCode(code)
  if (!normalizedCode || !Number.isSafeInteger(cartSubtotalCents) || cartSubtotalCents < 0) return null
  const recordCode = normalizePromoCode(record.code)
  if (!recordCode || recordCode !== normalizedCode) return null
  if (record.active !== true) return null
  if (isExpired(record.expiresAt, now)) return null

  const type = record.type
  if (type !== 'free_shipping' && type !== 'percent_pro' && type !== 'percent' && type !== 'amount') {
    return null
  }

  if (type === 'free_shipping') {
    return {
      code: normalizedCode,
      type,
      discountAmountCents: 0,
      freeShipping: true,
      label: makeLabel(type),
    }
  }

  const discountPercent = type === 'percent_pro'
    ? (cartSubtotalCents >= 40_000 ? 20 : 15)
    : finitePositiveNumber(record.discountPercent)

  if (type === 'percent_pro' || type === 'percent') {
    if (discountPercent === null || discountPercent > 100 || cartSubtotalCents <= 0) return null
    const discountAmountCents = Math.round((cartSubtotalCents * discountPercent) / 100)
    if (discountAmountCents < 0 || discountAmountCents > cartSubtotalCents) return null

    return {
      code: normalizedCode,
      type,
      discountAmountCents,
      discountPercent,
      freeShipping: false,
      label: makeLabel(type, discountPercent),
    }
  }

  const configuredAmount = finitePositiveNumber(record.discountAmount)
  const discountAmountCents = configuredAmount === null ? null : moneyToCents(configuredAmount)
  if (discountAmountCents === null || discountAmountCents <= 0 || discountAmountCents > cartSubtotalCents) return null

  return {
    code: normalizedCode,
    type,
    discountAmountCents,
    freeShipping: false,
    label: makeLabel(type),
  }
}

function chargedProductLine(
  item: CheckoutCartItem,
  qty: number,
  unitAmountCents: number,
): ChargedProductLine {
  return {
    sku: item.sku,
    qty,
    name: item.productName,
    variantLabel: item.variantLabel,
    price: unitAmountCents / 100,
    unitAmountCents,
  }
}

export function allocateProductDiscount(
  items: unknown,
  discountAmountCents: number,
): ChargedProductLine[] | null {
  const normalizedItems = normalizeCheckoutItems(items)
  if (
    !normalizedItems
    || !Number.isSafeInteger(discountAmountCents)
    || discountAmountCents < 0
  ) return null

  const subtotalCents = cartSubtotalCents(normalizedItems)
  if (subtotalCents === null || discountAmountCents > subtotalCents) return null

  const chargedLines: ChargedProductLine[] = []
  let remainingDiscountCents = discountAmountCents
  let remainingSubtotalCents = subtotalCents

  for (let index = 0; index < normalizedItems.length; index += 1) {
    const item = normalizedItems[index]!
    const unitPriceCents = moneyToCents(item.price)!
    const lineSubtotalCents = unitPriceCents * item.quantity
    const lineDiscountCents = index === normalizedItems.length - 1
      ? remainingDiscountCents
      // BigInt keeps proportional allocation exact even for large safe integer inputs.
      : Number((BigInt(remainingDiscountCents) * BigInt(lineSubtotalCents)) / BigInt(remainingSubtotalCents))
    const lowReductionCents = Math.floor(lineDiscountCents / item.quantity)
    const highReductionCents = Math.ceil(lineDiscountCents / item.quantity)
    const highReductionQty = lineDiscountCents % item.quantity
    const lowReductionQty = item.quantity - highReductionQty

    if (highReductionCents > unitPriceCents) return null
    if (lowReductionQty > 0) {
      chargedLines.push(chargedProductLine(item, lowReductionQty, unitPriceCents - lowReductionCents))
    }
    if (highReductionQty > 0) {
      chargedLines.push(chargedProductLine(item, highReductionQty, unitPriceCents - highReductionCents))
    }

    remainingDiscountCents -= lineDiscountCents
    remainingSubtotalCents -= lineSubtotalCents
  }

  if (remainingDiscountCents !== 0) return null
  return chargedLines
}

export function calculateCheckoutPromo(args: {
  promoCode?: unknown
  items: unknown
  record?: PromoRecord | null
  now?: Date
}): CheckoutPromoResult {
  const normalizedCode = normalizePromoCode(args.promoCode)
  if (args.promoCode === undefined || args.promoCode === null || args.promoCode === '') return { status: 'none' }
  if (!normalizedCode) return { status: 'invalid' }

  const subtotal = cartSubtotalCents(args.items)
  if (subtotal === null || !args.record) return { status: 'invalid' }

  const promo = calculatePromoDiscount(normalizedCode, args.record, subtotal, args.now)
  return promo ? { status: 'valid', promo, cartSubtotalCents: subtotal } : { status: 'invalid' }
}

export function buildCheckoutMetadata(args: {
  orderRef: string
  customer: CheckoutCustomer
  chargedProductLines: ChargedProductLine[]
  promo?: ValidatedPromo | null
}): Record<string, string> | null {
  const metadata: Record<string, string> = {
    order_ref: args.orderRef,
    customer_name: args.customer.name,
    customer_country: args.customer.country,
    customer_address: `${args.customer.address}|${args.customer.city}|${args.customer.postalCode}`,
    customer_phone: args.customer.phone,
    items_json: JSON.stringify(args.chargedProductLines.map((item) => ({
      sku: item.sku,
      qty: item.qty,
      name: item.name,
      variantLabel: item.variantLabel,
      price: item.price,
    }))),
  }

  if (args.promo) {
    metadata.promo_code = args.promo.code
    metadata.promo_type = args.promo.type
    metadata.promo_discount_amount_cents = String(args.promo.discountAmountCents)
    metadata.promo_discount_amount = formatCents(args.promo.discountAmountCents)
    metadata.promo_free_shipping = String(args.promo.freeShipping)
    metadata.promo_discount_snapshot = JSON.stringify({
      type: args.promo.type,
      discountAmountCents: args.promo.discountAmountCents,
      discountAmount: formatCents(args.promo.discountAmountCents),
      discountPercent: args.promo.discountPercent ?? null,
      freeShipping: args.promo.freeShipping,
    })
  }

  const metadataEntries = Object.entries(metadata)
  if (
    metadataEntries.length > 50
    || metadataEntries.some(([key, value]) => (
      key.length > MAX_STRIPE_METADATA_KEY_LENGTH
      || value.length > MAX_STRIPE_METADATA_VALUE_LENGTH
    ))
  ) return null

  return metadata
}

export function parseEnvPromoType(value: unknown): PromoType | null {
  return value === 'free_shipping' || value === 'percent_pro' ? value : null
}
