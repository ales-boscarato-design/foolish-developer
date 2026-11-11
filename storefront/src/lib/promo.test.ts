import assert from 'node:assert/strict'
import test from 'node:test'
import {
  allocateProductDiscount,
  buildCheckoutMetadata,
  calculateCheckoutPromo,
  calculateServerShippingCostCents,
  cartSubtotalCents,
  normalizeCheckoutCustomer,
  normalizeCheckoutItems,
  parsePromoCodes,
} from './promo'
import { ALLOWED_SHIPPING_COUNTRIES, getShippingZone, shippingRequiresQuote } from './shipping'
import { resolveExtraEuShipping } from './landed-cost'
import { EXTRA_EU_MINIMUM_SHIPPING_CENTS } from './landed-cost-price'

const items = [{ price: 100, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' }]
const now = new Date('2026-09-11T12:00:00.000Z')

test('tiered reseller promo applies exact inclusive thresholds and rejects below minimum or malformed tiers', () => {
  const promo = {
    code: 'DAVID30', type: 'percent_tiered', active: true,
    minSubtotalCents: 20_000, tier2SubtotalCents: 50_000,
    discountPercent: 30, tier2DiscountPercent: 35,
  }
  const cases = [
    [199.99, 'invalid', null],
    [200, 'valid', 30],
    [350, 'valid', 30],
    [500, 'valid', 30],
    [500.01, 'valid', 35],
    [1_200, 'valid', 35],
  ] as const
  for (const [price, status, discountPercent] of cases) {
    const result = calculateCheckoutPromo({
      promoCode: 'DAVID30', items: [{ price, quantity: 1, productName: 'Catalog item', variantLabel: 'Standard', sku: 'SKU-1' }], record: promo, now,
    })
    assert.equal(result.status, status, `${price} EUR`)
    if (result.status === 'valid') {
      assert.equal(result.promo.discountPercent, discountPercent, `${price} EUR percent`)
      assert.equal(result.promo.discountAmountCents, Math.round(price * 100 * discountPercent! / 100))
    }
  }
  for (const malformed of [
    { ...promo, tier2SubtotalCents: 19_999 },
    { ...promo, tier2SubtotalCents: 20_000 },
    { ...promo, discountPercent: 0 },
    { ...promo, tier2DiscountPercent: 101 },
    // Non progressivo: secondo livello uguale o piu' basso del primo non deve mai passare.
    { ...promo, tier2DiscountPercent: 30 },
    { ...promo, discountPercent: 40 },
    { ...promo, minSubtotalCents: undefined },
    { ...promo, minSubtotalCents: null },
    { ...promo, tier2DiscountPercent: undefined },
    { ...promo, tier2DiscountPercent: null },
  ]) {
    assert.equal(calculateCheckoutPromo({ promoCode: 'DAVID30', items, record: malformed, now }).status, 'invalid')
  }
})

// SKU e prezzi reali: catalogo del CMS di produzione, lettura read-only del
// 2026-10-27 (`GET /api/products?limit=100&depth=0`). Il catalogo server-side fa
// pagare `variants[].price`; i `priceTiers` prodotto del CMS non sono consumati
// dallo storefront, quindi lo sconto si applica al listino della variante e non
// si cumula con sconti quantità.
interface RealCatalogCase {
  sku: string
  variantLabel: string
  productName: string
  price: number
  quantity: number
  subtotal: number
  status: 'valid' | 'invalid'
  discountPercent: number | null
  discountAmountCents: number
}

const realCatalogCases: RealCatalogCase[] = [
  { sku: 'TS-A5', variantLabel: 'A5', productName: 'T-Sheet Skin -DBL-', price: 12.5, quantity: 5, subtotal: 62.5, status: 'invalid', discountPercent: null, discountAmountCents: 0 },
  { sku: 'TS-A4', variantLabel: 'A4', productName: 'T-Sheet Skin -DBL-', price: 23.9, quantity: 8, subtotal: 191.2, status: 'invalid', discountPercent: null, discountAmountCents: 0 },
  { sku: 'TS-A5', variantLabel: 'A5', productName: 'T-Sheet Skin -DBL-', price: 12.5, quantity: 16, subtotal: 200, status: 'valid', discountPercent: 30, discountAmountCents: 6_000 },
  { sku: 'TS-A4', variantLabel: 'A4', productName: 'T-Sheet Skin -DBL-', price: 23.9, quantity: 9, subtotal: 215.1, status: 'valid', discountPercent: 30, discountAmountCents: 6_453 },
  { sku: 'TS-A5', variantLabel: 'A5', productName: 'T-Sheet Skin -DBL-', price: 12.5, quantity: 40, subtotal: 500, status: 'valid', discountPercent: 30, discountAmountCents: 15_000 },
  { sku: 'DS-A3', variantLabel: 'A3', productName: 'T-Sheet -Duoskin-', price: 97.2, quantity: 6, subtotal: 583.2, status: 'valid', discountPercent: 35, discountAmountCents: 20_412 },
  { sku: 'TS-VB', variantLabel: 'Very Big', productName: 'T-Sheet Skin -DBL-', price: 135, quantity: 4, subtotal: 540, status: 'valid', discountPercent: 35, discountAmountCents: 18_900 },
  { sku: 'TR-ROLL', variantLabel: 'Rotolo', productName: 'T-Sheet DBL In rotolo', price: 203.95, quantity: 3, subtotal: 611.85, status: 'valid', discountPercent: 35, discountAmountCents: 21_415 },
]

test('tiered reseller promo on real catalog SKUs and variant prices', () => {
  const promo = {
    code: 'DAVID30', type: 'percent_tiered', active: true,
    minSubtotalCents: 20_000, tier2SubtotalCents: 50_000,
    discountPercent: 30, tier2DiscountPercent: 35,
  }
  for (const catalogCase of realCatalogCases) {
    const label = `${catalogCase.sku} x${catalogCase.quantity} = ${catalogCase.subtotal} EUR`
    const cart = [{
      productName: catalogCase.productName,
      variantLabel: catalogCase.variantLabel,
      sku: catalogCase.sku,
      price: catalogCase.price,
      quantity: catalogCase.quantity,
    }]
    assert.equal(cartSubtotalCents(cart), Math.round(catalogCase.subtotal * 100), `${label} subtotale`)
    const result = calculateCheckoutPromo({ promoCode: 'DAVID30', items: cart, record: promo, now })
    assert.equal(result.status, catalogCase.status, label)
    if (result.status !== 'valid') continue
    assert.equal(result.promo.discountPercent, catalogCase.discountPercent, label)
    assert.equal(result.promo.discountAmountCents, catalogCase.discountAmountCents, label)
  }
})

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

test('extra-UE: questa funzione non prezza la dogana, e il prezzo che il checkout incassa non scende mai sotto il pavimento', async () => {
  const cart = normalizeCheckoutItems([{
    price: 99,
    quantity: 1,
    productName: 'Test',
    variantLabel: 'A',
    sku: 'TEST',
  }])
  assert.ok(cart)
  if (!cart) return

  const extraEuCountries = ALLOWED_SHIPPING_COUNTRIES
    .filter((country) => getShippingZone(country) === 'EXTRA_EU')
  assert.ok(
    extraEuCountries.length >= 8,
    `elenco delle destinazioni extra-UE inatteso: ${extraEuCountries.join(',')}`,
  )

  // 1. Il rifiuto e' DICHIARATO, non un valore sbagliato. Una stima sincrona del
  //    solo profilo non puo' che stare sotto il prezzo che il checkout incassa
  //    (quota live, tabella in casa e pavimento vivono in
  //    `resolveExtraEuShipping`): misurato l'11/11/2026 su un carrello da 99,00
  //    su questo albero, NO 76,54 prodotti contro 81,22 incassati, CA 87,41
  //    contro 95,73, GB 63,83 contro 66,51, JP 105,05 contro 111,65. Se questa
  //    asserzione diventa rossa, qualcuno ha reintrodotto la seconda autorita' di
  //    prezzo: la dogana torna a passare da `resolveExtraEuShipping`, non da qui.
  for (const country of extraEuCountries) {
    for (const promo of [true, false]) {
      assert.equal(
        calculateServerShippingCostCents(cart, country, promo),
        null,
        `${country} (promo=${promo}): la spedizione extra-UE non si prezza da questa funzione`,
      )
    }
  }

  // 2. Il rifiuto non lascia un buco: sulle destinazioni che si vendono (BR non
  //    ha una linea DDP e si quota a mano) l'autorita' vera risponde, e non
  //    scende mai sotto il pavimento di spedizione — promo o non promo, perche'
  //    su extra-UE la promo non entra in questo prezzo.
  for (const country of extraEuCountries) {
    if (shippingRequiresQuote(country)) continue
    const resolution = await resolveExtraEuShipping({
      countryCode: country,
      goodsCents: cartSubtotalCents(cart) ?? 0,
      items: cart.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      quoteConfig: { url: 'http://127.0.0.1:9/quote', secret: '', enabled: false },
    })
    assert.ok(resolution, `${country}: nessun prezzo nemmeno dall'autorita' extra-UE`)
    assert.ok(
      resolution.costCents >= EXTRA_EU_MINIMUM_SHIPPING_CENTS,
      `${country}: ${resolution.costCents} sotto il pavimento di ${EXTRA_EU_MINIMUM_SHIPPING_CENTS}`,
    )
  }

  // 3. Unione Europea: il comportamento di prima non cambia (tariffa corriere,
  //    azzerata dalla promo solo dove la tariffa e' il solo trasporto).
  assert.equal(calculateServerShippingCostCents(cart, 'DE', true), 0)
  assert.equal(calculateServerShippingCostCents(cart, 'DE', false), 1499)
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
