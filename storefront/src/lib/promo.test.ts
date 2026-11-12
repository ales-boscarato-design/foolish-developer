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
    // Nome e cognome arrivano dal nome completo: e' il percorso storico, dove
    // il cliente ha scritto una sola stringa.
    firstName: 'Test',
    lastName: 'Customer',
    name: 'Test Customer',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
    province: null,
    phone: '',
    nameDerived: true,
  })
  assert.equal(normalizeCheckoutCustomer({ ...valid, name: 123 }), null)
  assert.equal(normalizeCheckoutCustomer({ ...valid, country: 'ITA' }), null)
  assert.equal(normalizeCheckoutCustomer({ ...valid, country: 'XX' }), null)
  assert.equal(normalizeCheckoutCustomer([]), null)
  assert.equal(normalizeCheckoutCustomer({ ...valid, name: 'x'.repeat(121) }), null)
})

test('solo il nome completo: nome e cognome derivati, nessun 409 in coda (fallback del riordino)', () => {
  const customer = normalizeCheckoutCustomer({
    email: 'cliente@example.test',
    name: 'Mario Rossi',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
  })

  assert.ok(customer)
  if (!customer) return
  assert.equal(customer.firstName, 'Mario')
  assert.equal(customer.lastName, 'Rossi')
  assert.equal(customer.name, 'Mario Rossi')
  assert.equal(customer.nameDerived, true)
  assert.equal(customer.province, null)
})

test('nome di una parola sola: il cognome resta vuoto invece di essere duplicato', () => {
  const customer = normalizeCheckoutCustomer({
    email: 'cliente@example.test',
    name: 'Madonna',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
  })

  assert.ok(customer)
  if (!customer) return
  assert.equal(customer.firstName, 'Madonna')
  assert.equal(customer.lastName, '')
  assert.equal(customer.name, 'Madonna')
})

test('checkout italiano con campi separati: nome composto e sigla normalizzata', () => {
  const customer = normalizeCheckoutCustomer({
    email: 'cliente@example.test',
    firstName: ' Mario ',
    lastName: 'De Rossi',
    country: 'it',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
    province: 'to',
  }, { structuredAddressCollected: true })

  assert.ok(customer)
  if (!customer) return
  assert.equal(customer.firstName, 'Mario')
  assert.equal(customer.lastName, 'De Rossi')
  assert.equal(customer.name, 'Mario De Rossi')
  assert.equal(customer.province, 'TO')
  assert.equal(customer.nameDerived, false)
})

test('checkout italiano senza provincia: accettato, provincia null', () => {
  const customer = normalizeCheckoutCustomer({
    email: 'cliente@example.test',
    firstName: 'Mario',
    lastName: 'Rossi',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
    province: '',
  }, { structuredAddressCollected: true })

  assert.ok(customer)
  assert.equal(customer?.province, null)
})

test('checkout non italiano: nessun obbligo dei campi italiani', () => {
  const customer = normalizeCheckoutCustomer({
    email: 'cliente@example.fr',
    name: 'Jean Dupont',
    country: 'FR',
    address: '1 Rue de Test',
    city: 'Paris',
    postalCode: '75001',
  }, { structuredAddressCollected: true })

  assert.ok(customer)
  if (!customer) return
  assert.equal(customer.firstName, 'Jean')
  assert.equal(customer.lastName, 'Dupont')
  assert.equal(customer.province, null)
})

test('provincia malformata: rifiutata dove viene raccolta, scartata dove non lo e', () => {
  const base = {
    email: 'cliente@example.test',
    firstName: 'Mario',
    lastName: 'Rossi',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
    province: 'Torino',
  }

  // Pagina checkout: il campo c'e' ed e' sbagliato, quindi e' un errore del client.
  assert.equal(normalizeCheckoutCustomer(base, { structuredAddressCollected: true }), null)

  // Riordino di un ordine storico con un valore legacy: la sigla si perde, il
  // riordino no.
  const legacy = normalizeCheckoutCustomer(base)
  assert.ok(legacy)
  assert.equal(legacy?.province, null)
})

test('metadata Stripe: nome e cognome separati, provincia solo se presente', () => {
  const lines = allocateProductDiscount([{
    price: 10,
    quantity: 1,
    productName: 'Test',
    variantLabel: 'A',
    sku: 'TEST',
  }], 0)
  assert.ok(lines)

  const withProvince = normalizeCheckoutCustomer({
    email: 'cliente@example.test',
    firstName: 'Mario',
    lastName: 'Rossi',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
    province: 'TO',
  }, { structuredAddressCollected: true })
  assert.ok(withProvince)

  const metadata = buildCheckoutMetadata({
    orderRef: 'FOOLISH-TEST',
    customer: withProvince!,
    chargedProductLines: lines!,
  })
  assert.ok(metadata)
  assert.equal(metadata.customer_first_name, 'Mario')
  assert.equal(metadata.customer_last_name, 'Rossi')
  assert.equal(metadata.customer_name, 'Mario Rossi')
  assert.equal(metadata.customer_province, 'TO')

  // Senza provincia la chiave non esiste: una stringa vuota sarebbe un valore
  // che Stripe conserva e che il CMS leggerebbe come dato.
  const withoutProvince = normalizeCheckoutCustomer({
    email: 'cliente@example.test',
    name: 'Mario Rossi',
    country: 'IT',
    address: 'Via Test 1',
    city: 'Torino',
    postalCode: '10100',
  })
  assert.ok(withoutProvince)
  const metadataWithout = buildCheckoutMetadata({
    orderRef: 'FOOLISH-TEST-2',
    customer: withoutProvince!,
    chargedProductLines: lines!,
  })
  assert.ok(metadataWithout)
  assert.equal('customer_province' in metadataWithout, false)
  assert.equal(metadataWithout.customer_first_name, 'Mario')
  assert.equal(metadataWithout.customer_last_name, 'Rossi')
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

test('extra-UE: la funzione sincrona e il checkout danno lo STESSO prezzo, oppure rifiutano entrambi', async () => {
  const cart99 = normalizeCheckoutItems([{
    price: 99,
    quantity: 1,
    productName: 'Test',
    variantLabel: 'A',
    sku: 'TEST',
  }])
  assert.ok(cart99)
  if (!cart99) return

  const extraEuCountries = ALLOWED_SHIPPING_COUNTRIES
    .filter((country) => getShippingZone(country) === 'EXTRA_EU')
  assert.ok(
    extraEuCountries.length >= 8,
    `elenco delle destinazioni extra-UE inatteso: ${extraEuCountries.join(',')}`,
  )

  const cart146 = normalizeCheckoutItems([
    { price: 99, quantity: 1, productName: 'Test', variantLabel: 'A', sku: 'TEST' },
    { price: 23.9, quantity: 2, productName: 'Test 2', variantLabel: 'B', sku: 'TEST-2' },
  ])
  assert.ok(cart146)
  if (!cart146) return
  const carts = [cart99, cart146]
  const noQuote = { url: 'http://127.0.0.1:9/quote', secret: '', enabled: false }

  // 1. Stesso numero, o stesso rifiuto. Due percorsi che prezzano la stessa
  //    destinazione con due aritmetiche diverse divergono in qualche
  //    combinazione: e' la classe di difetto misurata l'11/11/2026 (AU 99,00:
  //    105,30 dal profilo del paese contro 52,49 incassati col profilo
  //    svizzero). Qui la funzione sincrona CHIAMA la stessa aritmetica del
  //    checkout, quindi il confronto non puo' passare per caso.
  for (const cart of carts) {
    const subtotal = cartSubtotalCents(cart) ?? 0
    const items = cart.map((item) => ({ sku: item.sku, quantity: item.quantity }))
    for (const country of extraEuCountries) {
      for (const promo of [true, false]) {
        const sync = calculateServerShippingCostCents(cart, country, promo)
        const resolution = await resolveExtraEuShipping({
          countryCode: country,
          goodsCents: subtotal,
          items,
          quoteConfig: noQuote,
        })
        assert.equal(sync, resolution?.costCents ?? null, `${country} merce ${subtotal} (promo=${promo})`)
      }
    }
  }

  // 2. I numeri sono quelli post-merge con la tabella rigenerata dalla quota
  //    dell'11/11/2026 (#54): base = max(profilo del PAESE, banda in casa), poi
  //    +10% di margine e pavimento a 48,00. Ogni riga dichiara da quale lato
  //    viene la base: la tabella in casa e' la prima fonte di ripiego e vince
  //    quando supera il profilo; il profilo vince dove la tabella non ha banda
  //    (AU) o resta sotto. Valori misurati sul carrello da 99,00 dopo il merge
  //    con `main` 337b3c4, non copiati: vedi `landed-cost-price.ts`.
  //    La promo "spedizione gratuita" non entra in questo prezzo: azzererebbe
  //    anche dazi, IVA all'importazione e fee DDP, che non sono sconto.
  const casi: [string, number | null, string][] = [
    ['CH', 5224, 'tabella 47,49 > profilo 47,29'],
    ['GB', 6661, 'tabella 60,55 > profilo 57,86'],
    ['NO', 8170, 'tabella 74,27 > profilo 69,69'],
    ['US', 10_007, 'profilo 90,97 > tabella 79,52'],
    ['CA', 9656, 'tabella 87,78 > profilo 79,82'],
    ['AU', 10_615, 'profilo 96,50, la tabella non ha una banda per AU'],
    ['JP', 11_287, 'tabella 102,61 > profilo 96,26'],
    ['BR', null, 'nessuna linea DDP: nessuna base di prezzo, nessun prezzo'],
  ]
  for (const [country, atteso, perche] of casi) {
    assert.equal(
      calculateServerShippingCostCents(cart99, country, false),
      atteso,
      `${country} merce 99,00 (${perche})`,
    )
    assert.equal(
      calculateServerShippingCostCents(cart99, country, true),
      atteso,
      `${country} merce 99,00 con promo spedizione gratuita (${perche})`,
    )
  }

  const au = await resolveExtraEuShipping({
    countryCode: 'AU',
    goodsCents: 9900,
    items: cart99.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    quoteConfig: noQuote,
  })
  assert.ok(au)
  assert.notEqual(au.costCents, 5249, 'AU non si prezza col profilo di un altro paese')
  assert.equal(au.costCents, 10_615)

  // 3. Paese senza profilo (nessuna linea DDP: oggi il Brasile): NESSUNO dei due
  //    percorsi inventa un prezzo. Il rifiuto e' dichiarato, non un 48,00.
  assert.equal(shippingRequiresQuote('BR'), true)
  assert.equal(calculateServerShippingCostCents(cart99, 'BR', false), null)
  assert.equal(calculateServerShippingCostCents(cart99, 'BR', true), null)
  assert.equal(
    await resolveExtraEuShipping({
      countryCode: 'BR',
      goodsCents: 9900,
      items: cart99.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      quoteConfig: noQuote,
    }),
    null,
  )

  // 4. Unione Europea: il comportamento di prima non cambia (tariffa corriere,
  //    azzerata dalla promo solo dove la tariffa e' il solo trasporto).
  assert.equal(calculateServerShippingCostCents(cart99, 'DE', true), 0)
  assert.equal(calculateServerShippingCostCents(cart99, 'DE', false), 1499)
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
      firstName: 'Test',
      lastName: 'Customer',
      name: 'Test Customer',
      country: 'IT',
      address: 'Via Test 1',
      city: 'Torino',
      postalCode: '10100',
      province: null,
      phone: '',
      nameDerived: true,
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
