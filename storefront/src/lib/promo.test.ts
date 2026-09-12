import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateProductDiscount,
  buildCheckoutMetadata,
  calculateCheckoutPromo,
  calculateServerShippingCostCents,
  normalizeCheckoutCustomer,
  normalizeCheckoutItems,
  parsePromoCodes,
} from './promo'

const items = [{ price: 100, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' }]
const now = new Date('2026-09-11T12:00:00.000Z')

test('calculates a percent promo from the server record and cart subtotal', () => {
  const result = calculateCheckoutPromo({
    promoCode: 'SAVE15',
    items,
    record: { code: 'SAVE15', type: 'percent', active: true, discountPercent: 15 },
    now,
  })

  assert.equal(result.status, 'valid')
  if (result.status !== 'valid') return
  assert.equal(result.promo.discountAmountCents, 1_500)
  assert.equal(result.promo.discountPercent, 15)
})

test('preserves the historical percent_pro threshold', () => {
  const belowThreshold = calculateCheckoutPromo({
    promoCode: 'PRO',
    items: [{ price: 399.99, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' }],
    record: { code: 'PRO', type: 'percent_pro', active: true },
    now,
  })
  const atThreshold = calculateCheckoutPromo({
    promoCode: 'PRO',
    items: [{ price: 400, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' }],
    record: { code: 'PRO', type: 'percent_pro', active: true },
    now,
  })

  assert.equal(belowThreshold.status, 'valid')
  assert.equal(atThreshold.status, 'valid')
  if (belowThreshold.status !== 'valid' || atThreshold.status !== 'valid') return
  assert.equal(belowThreshold.promo.discountPercent, 15)
  assert.equal(belowThreshold.promo.discountAmountCents, 6_000)
  assert.equal(atThreshold.promo.discountPercent, 20)
  assert.equal(atThreshold.promo.discountAmountCents, 8_000)
})

test('models a future Nestor code as a normal CMS percent promo', () => {
  const result = calculateCheckoutPromo({
    promoCode: 'NESTOR',
    items: [{ price: 500, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' }],
    record: { code: 'NESTOR', type: 'percent', active: true, discountPercent: 15 },
    now,
  })

  assert.equal(result.status, 'valid')
  if (result.status !== 'valid') return
  assert.equal(result.promo.discountPercent, 15)
  assert.equal(result.promo.discountAmountCents, 7_500)
})

test('rejects a CMS code mismatch and unsupported percent offers', () => {
  const mismatch = calculateCheckoutPromo({
    promoCode: 'SAVE15',
    items,
    record: { code: 'OTHER', type: 'percent', active: true, discountPercent: 15 },
    now,
  })
  const percentOffer = calculateCheckoutPromo({
    promoCode: 'OFFER15',
    items,
    record: { code: 'OFFER15', type: 'percent_offer', active: true, discountPercent: 15 },
    now,
  })

  assert.equal(mismatch.status, 'invalid')
  assert.equal(percentOffer.status, 'invalid')
})

test('normalizes only plain, bounded customer fields and two-letter countries', () => {
  const valid = normalizeCheckoutCustomer({
    email: ' test@example.com ',
    name: 'Test Customer',
    country: 'it',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
  })
  assert.deepEqual(valid, {
    email: 'test@example.com',
    name: 'Test Customer',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
    phone: '',
  })
  assert.equal(normalizeCheckoutCustomer({ ...valid, name: 123 }), null)
  assert.equal(normalizeCheckoutCustomer({ ...valid, country: 'ITA' }), null)
  assert.equal(normalizeCheckoutCustomer({ ...valid, country: 'XX' }), null)
  assert.equal(normalizeCheckoutCustomer([]), null)
  assert.equal(normalizeCheckoutCustomer({ ...valid, name: 'x'.repeat(121) }), null)
})

test('server shipping uses the normalized subtotal and preserves free-above-threshold behavior', () => {
  const belowThresholdItems = normalizeCheckoutItems([{
    price: 49,
    quantity: 1,
    productName: 'Test',
    variantLabel: 'A',
    sku: 'TEST',
  }])
  assert.ok(belowThresholdItems)
  if (!belowThresholdItems) return
  const manipulatedShippingCost = 0
  assert.equal(calculateServerShippingCostCents(belowThresholdItems, 'IT', false), 765)
  assert.notEqual(calculateServerShippingCostCents(belowThresholdItems, 'IT', false), manipulatedShippingCost)

  const thresholdItems = normalizeCheckoutItems([{
    price: 50,
    quantity: 1,
    productName: 'Test',
    variantLabel: 'A',
    sku: 'TEST',
  }])
  assert.ok(thresholdItems)
  if (!thresholdItems) return
  assert.equal(calculateServerShippingCostCents(thresholdItems, 'IT', false), 0)
  assert.equal(calculateServerShippingCostCents(thresholdItems, 'IT', true), 0)
  assert.equal(calculateServerShippingCostCents(thresholdItems, 'XX', false), null)
})

test('allocates a discount across non-negative product prices with at most two lines per item', () => {
  const lines = allocateProductDiscount([
    { price: 10, quantity: 3, productName: 'Test', variantLabel: 'A', sku: 'TEST-A' },
    { price: 5, quantity: 2, productName: 'Second', variantLabel: 'B', sku: 'TEST-B' },
  ], 777)

  assert.ok(lines)
  if (!lines) return
  assert.ok(lines.every((line) => line.unitAmountCents >= 0))
  assert.ok(lines.filter((line) => line.sku === 'TEST-A').length <= 2)
  assert.ok(lines.filter((line) => line.sku === 'TEST-B').length <= 2)

  const chargedProductTotalCents = lines.reduce(
    (total, line) => total + line.unitAmountCents * line.qty,
    0,
  )
  assert.equal(chargedProductTotalCents, 4_000 - 777)
  assert.equal(lines.reduce((total, line) => total + line.unitAmountCents * line.qty, 0) + 777, 4_000)

  const fullyDiscountedLines = allocateProductDiscount([
    { price: 10, quantity: 3, productName: 'Test', variantLabel: 'A', sku: 'TEST' },
  ], 3_000)
  assert.ok(fullyDiscountedLines?.every((line) => line.unitAmountCents >= 0))
  assert.equal(fullyDiscountedLines?.reduce((total, line) => total + line.unitAmountCents * line.qty, 0), 0)
})

test('splits a quantity only when per-unit discount rounding requires it', () => {
  const lines = allocateProductDiscount([
    { price: 10, quantity: 3, productName: 'Test', variantLabel: 'A', sku: 'TEST' },
  ], 100)

  assert.deepEqual(lines?.map(({ unitAmountCents, qty }) => ({ unitAmountCents, qty })), [
    { unitAmountCents: 967, qty: 2 },
    { unitAmountCents: 966, qty: 1 },
  ])
  assert.equal(lines?.reduce((total, line) => total + line.unitAmountCents * line.qty, 0), 2_900)
})

test('calculates a fixed amount promo in cents', () => {
  const result = calculateCheckoutPromo({
    promoCode: 'FIXED20',
    items,
    record: { code: 'FIXED20', type: 'amount', active: true, discountAmount: 20 },
    now,
  })

  assert.equal(result.status, 'valid')
  if (result.status !== 'valid') return
  assert.equal(result.promo.discountAmountCents, 2_000)
})

test('validates free shipping without creating a monetary discount', () => {
  const result = calculateCheckoutPromo({
    promoCode: 'SHIPFREE',
    items,
    record: { code: 'SHIPFREE', type: 'free_shipping', active: true },
    now,
  })

  assert.equal(result.status, 'valid')
  if (result.status !== 'valid') return
  assert.equal(result.promo.freeShipping, true)
  assert.equal(result.promo.discountAmountCents, 0)
})

test('rejects expired and inactive promo records', () => {
  const expired = calculateCheckoutPromo({
    promoCode: 'OLD15',
    items,
    record: { code: 'OLD15', type: 'percent', active: true, discountPercent: 15, expiresAt: '2026-09-10T23:59:59.000Z' },
    now,
  })
  const inactive = calculateCheckoutPromo({
    promoCode: 'OFF15',
    items,
    record: { code: 'OFF15', type: 'percent', active: false, discountPercent: 15 },
    now,
  })

  assert.equal(expired.status, 'invalid')
  assert.equal(inactive.status, 'invalid')
})

test('ignores a manipulated client discount amount', () => {
  const request = {
    promoCode: 'SAVE15',
    items,
    record: { code: 'SAVE15', type: 'percent', active: true, discountPercent: 15 },
    discountAmount: 99_999,
  }
  const result = calculateCheckoutPromo(request)

  assert.equal(result.status, 'valid')
  if (result.status !== 'valid') return
  assert.equal(result.promo.discountAmountCents, 1_500)
})

test('rejects a fixed discount larger than the cart', () => {
  const result = calculateCheckoutPromo({
    promoCode: 'TOOMUCH',
    items,
    record: { code: 'TOOMUCH', type: 'amount', active: true, discountAmount: 100.01 },
    now,
  })

  assert.equal(result.status, 'invalid')
})

test('rejects malformed, negative, or over-100 percent configuration', () => {
  const malformed = calculateCheckoutPromo({
    promoCode: 'BAD1',
    items,
    record: { code: 'BAD1', type: 'percent', active: true, discountPercent: '15' },
    now,
  })
  const negative = calculateCheckoutPromo({
    promoCode: 'BAD2',
    items,
    record: { code: 'BAD2', type: 'amount', active: true, discountAmount: -1 },
    now,
  })
  const excessivePercent = calculateCheckoutPromo({
    promoCode: 'BAD3',
    items,
    record: { code: 'BAD3', type: 'percent', active: true, discountPercent: 100.01 },
    now,
  })

  assert.equal(malformed.status, 'invalid')
  assert.equal(negative.status, 'invalid')
  assert.equal(excessivePercent.status, 'invalid')
})

test('bounds cart payloads and rejects metadata that exceeds Stripe limits', () => {
  const item = { price: 10, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' }
  assert.equal(normalizeCheckoutItems(Array.from({ length: 51 }, () => item)), null)
  assert.equal(normalizeCheckoutItems([{ ...item, quantity: 101 }]), null)
  assert.equal(normalizeCheckoutItems([{ ...item, productName: 'x'.repeat(121) }]), null)

  const normalized = normalizeCheckoutItems([
    { ...item, productName: 'x'.repeat(120), variantLabel: 'v'.repeat(80), sku: 's'.repeat(100) },
    { ...item, productName: 'y'.repeat(120), variantLabel: 'w'.repeat(80), sku: 't'.repeat(100) },
  ])
  assert.ok(normalized)
  if (!normalized) return
  const chargedLines = allocateProductDiscount(normalized, 0)
  assert.ok(chargedLines)
  if (!chargedLines) return
  const metadata = buildCheckoutMetadata({
    orderRef: 'FOOLISH-TEST',
    customer: {
      email: 'test@example.com',
      name: 'Test Customer',
      country: 'IT',
      address: 'Via Test 1',
      city: 'Torino',
      postalCode: '10100',
      phone: '',
    },
    chargedProductLines: chargedLines,
  })
  assert.equal(metadata, null)
})

test('getCodes parsing safely ignores null, arrays, and non-record JSON', () => {
  assert.deepEqual(parsePromoCodes('null'), {})
  assert.deepEqual(parsePromoCodes('[]'), {})
  assert.deepEqual(parsePromoCodes('"free_shipping"'), {})
  assert.deepEqual(parsePromoCodes('{"SHIPFREE":"free_shipping","BROKEN":15}'), {
    SHIPFREE: 'free_shipping',
  })
})

test('missing or malformed promo codes do not produce a discount', () => {
  const missing = calculateCheckoutPromo({ promoCode: 'PRO', items, record: { type: 'percent_pro', active: true }, now })
  const malformed = calculateCheckoutPromo({ promoCode: 'SAVE 15', items, record: { code: 'SAVE15', type: 'percent_pro', active: true }, now })

  assert.equal(missing.status, 'invalid')
  assert.equal(malformed.status, 'invalid')
})
