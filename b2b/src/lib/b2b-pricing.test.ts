/**
 * Test del resolver che rende il CMS l'unica autorita' su SKU, prezzo e fasce.
 *
 * Modulo puro: nessuna rete, nessun Next. I numeri sono SINTETICI e inventati
 * per il test, non sono prezzi di listino.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAuthoritativeLines } from './b2b-pricing'
import type { ResolveLinesResult } from './b2b-pricing'

const TIERS = [
  { minQty: 10, maxQty: 49, discountPercent: 20 },
  { minQty: 50, maxQty: null, discountPercent: 30 },
]

function clampTiers(): typeof TIERS {
  return TIERS.map((tier) => ({ ...tier }))
}

function catalogProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1,
    slug: 'stencil-test',
    name: 'Stencil Test (sintetico)',
    active: true,
    priceTiers: clampTiers(),
    variants: [
      { id: 'v1', sku: 'ST-14', label: '14 cm', price: 14.99, stockStatus: 'available' },
    ],
    ...overrides,
  }
}

function catalog(product: Record<string, unknown> = catalogProduct()): unknown[] {
  return [product]
}

/** Kit sintetico: `active: false` in vetrina, vendibile nel catalogo reseller, senza fasce. */
function kitCatalog(): unknown[] {
  return [catalogProduct({
    id: 2,
    slug: 'kit-test',
    name: 'Kit Test (sintetico)',
    active: false,
    resellerVisible: true,
    priceTiers: [],
    variants: [{ sku: 'KIT-OFF', label: 'Standard', price: 9.99 }],
  })]
}

function line(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    productId: 1,
    productSlug: 'stencil-test',
    productName: 'Stencil Test (sintetico)',
    variantSku: 'ST-14',
    variantLabel: '14 cm',
    unitPrice: 14.99,
    qty: 1,
    priceTiers: clampTiers(),
    ...overrides,
  }
}

function expectError(result: ResolveLinesResult, status: number, error: string): void {
  assert.equal(result.ok, false, `atteso rifiuto ${error}, ottenuto ${JSON.stringify(result)}`)
  if (result.ok) return
  assert.equal(result.status, status, JSON.stringify(result))
  assert.equal(result.error, error, JSON.stringify(result))
}

function expectOk(result: ResolveLinesResult) {
  assert.equal(result.ok, true, `atteso successo, ottenuto ${JSON.stringify(result)}`)
  if (!result.ok) throw new Error('irraggiungibile')
  return result
}

// --- caso legittimo ---------------------------------------------------------

test('un carrello coerente col catalogo produce righe e totali in centesimi', () => {
  const result = expectOk(resolveAuthoritativeLines([line({ qty: 10 })], catalog()))
  assert.equal(result.productsTotalCents, 11992)
  assert.deepEqual(result.lines, [{
    productName: 'Stencil Test (sintetico)',
    variantLabel: '14 cm',
    variantSku: 'ST-14',
    qty: 10,
    unitPrice: 14.99,
    priceTiers: [
      { minQty: 10, maxQty: 49, discountPercent: 20 },
      { minQty: 50, maxQty: null, discountPercent: 30 },
    ],
    lineTotalCents: 11992,
  }])
})

test('nome, etichetta e prezzo vengono dal catalogo, non dal client', () => {
  const result = expectOk(resolveAuthoritativeLines([
    line({ productName: 'Nome finto', variantLabel: 'Etichetta finta' }),
  ], catalog()))
  assert.equal(result.lines[0].productName, 'Stencil Test (sintetico)')
  assert.equal(result.lines[0].variantLabel, '14 cm')
  assert.equal(result.lines[0].unitPrice, 14.99)
})

test('confini delle fasce: minQty-1, minQty, maxQty, maxQty+1', () => {
  const cases: Array<[number, number]> = [
    [9, 13491],   // sotto la prima fascia: listino pieno
    [10, 11992],  // inizio prima fascia (-20%)
    [49, 58761],  // fine prima fascia
    [50, 52465],  // inizio seconda fascia (-30%)
  ]
  for (const [qty, expected] of cases) {
    const result = expectOk(resolveAuthoritativeLines([line({ qty })], catalog()))
    assert.equal(result.lines[0].lineTotalCents, expected, `qty ${qty}`)
    assert.equal(result.productsTotalCents, expected, `qty ${qty}`)
  }
})

test('un prodotto senza fasce vale [] in entrambi i lati', () => {
  const product = catalogProduct({ priceTiers: [] })
  const result = expectOk(resolveAuthoritativeLines([line({ priceTiers: [], qty: 3 })], [product]))
  assert.equal(result.lines[0].priceTiers.length, 0)
  assert.equal(result.lines[0].lineTotalCents, 4497)
})

test('piu righe: i totali in centesimi si sommano', () => {
  const product = catalogProduct({
    variants: [
      { sku: 'ST-14', label: '14 cm', price: 14.99 },
      { sku: 'ST-20', label: '20 cm', price: 33.33 },
    ],
    priceTiers: [],
  })
  const result = expectOk(resolveAuthoritativeLines([
    line({ priceTiers: [], qty: 2 }),
    line({ variantSku: 'ST-20', unitPrice: 33.33, priceTiers: [], qty: 3 }),
  ], [product]))
  assert.equal(result.lines[0].lineTotalCents, 2998)
  assert.equal(result.lines[1].lineTotalCents, 9999)
  assert.equal(result.productsTotalCents, 12997)
})

test('difetto storico: 12,50 -35% x 50 = 406,25 EUR (40625 centesimi), non 406,50', () => {
  const product = catalogProduct({
    variants: [{ sku: 'R-1', label: 'Standard', price: 12.5 }],
    priceTiers: [{ minQty: 50, maxQty: null, discountPercent: 35 }],
  })
  const result = expectOk(resolveAuthoritativeLines([
    line({ variantSku: 'R-1', unitPrice: 12.5, priceTiers: product.priceTiers as unknown[], qty: 50 }),
  ], [product]))
  // 12,50 * 0,65 = 8,125 -> 8,125 * 50 = 406,25. Arrotondare prima il
  // prezzo unitario (8,13 * 50) darebbe 406,50: +0,25 EUR.
  assert.equal(result.lines[0].lineTotalCents, 40625)
  assert.equal(result.productsTotalCents, 40625)
})

test('arrotondamento al centesimo su prezzi che in virgola mobile non chiudono', () => {
  const product = catalogProduct({
    variants: [{ sku: 'X-1', label: 'Standard', price: 0.1 }],
    priceTiers: [],
  })
  const result = expectOk(resolveAuthoritativeLines([
    line({ variantSku: 'X-1', unitPrice: 0.1, priceTiers: [], qty: 3 }),
  ], [product]))
  // 0.1 * 3 = 0.30000000000000004 in virgola mobile.
  assert.equal(result.lines[0].lineTotalCents, 30)
  assert.equal(result.productsTotalCents, 30)
})

test('maxQty omesso dal CMS e null dal client sono lo stesso significato', () => {
  const product = catalogProduct({
    priceTiers: [{ minQty: 10, maxQty: 49, discountPercent: 20 }, { minQty: 50, discountPercent: 30 }],
  })
  const result = expectOk(resolveAuthoritativeLines([line({ qty: 50 })], [product]))
  assert.deepEqual(result.lines[0].priceTiers, [
    { minQty: 10, maxQty: 49, discountPercent: 20 },
    { minQty: 50, maxQty: null, discountPercent: 30 },
  ])
  assert.equal(result.lines[0].lineTotalCents, 52465)
})

test('un prodotto senza il campo resellerVisible resta vendibile (catalogo gia filtrato)', () => {
  const product = catalogProduct()
  delete product.resellerVisible
  expectOk(resolveAuthoritativeLines([line()], [product]))
})

// --- statura del carrello ---------------------------------------------------

test('items non array o vuoto: 400 righe_non_valide', () => {
  for (const items of [undefined, null, 'x', {}, [], 42]) {
    expectError(resolveAuthoritativeLines(items, catalog()), 400, 'righe_non_valide')
  }
})

test('piu di 100 righe: 400 righe_non_valide', () => {
  const items = Array.from({ length: 101 }, () => line())
  expectError(resolveAuthoritativeLines(items, catalog()), 400, 'righe_non_valide')
})

test('100 righe esatte sono ammesse', () => {
  const items = Array.from({ length: 100 }, () => line())
  const result = expectOk(resolveAuthoritativeLines(items, catalog()))
  assert.equal(result.lines.length, 100)
})

test('riga non oggetto: 400 riga_non_valida', () => {
  for (const row of [null, 'riga', 42, [], true]) {
    expectError(resolveAuthoritativeLines([row], catalog()), 400, 'riga_non_valida')
  }
})

// --- SKU --------------------------------------------------------------------

test('variantSku mancante, vuoto o non stringa: 400 sku_mancante', () => {
  for (const variantSku of [undefined, null, '', '   ', 14, {}]) {
    expectError(resolveAuthoritativeLines([line({ variantSku })], catalog()), 400, 'sku_mancante')
  }
})

test('SKU sconosciuto: 400 sku_non_disponibile', () => {
  expectError(resolveAuthoritativeLines([line({ variantSku: 'NON-ESISTE' })], catalog()), 400, 'sku_non_disponibile')
})

test('il confronto SKU e case-sensitive', () => {
  expectError(resolveAuthoritativeLines([line({ variantSku: 'st-14' })], catalog()), 400, 'sku_non_disponibile')
})

test('gli spazi attorno allo SKU vengono tolti prima del confronto', () => {
  const result = expectOk(resolveAuthoritativeLines([line({ variantSku: '  ST-14  ' })], catalog()))
  assert.equal(result.lines[0].variantSku, 'ST-14')
})

test('catalogo senza varianti o non array: SKU non trovato', () => {
  expectError(resolveAuthoritativeLines([line()], [catalogProduct({ variants: 'x' })]), 400, 'sku_non_disponibile')
  expectError(resolveAuthoritativeLines([line()], []), 400, 'sku_non_disponibile')
})

test('prodotto con active: false ma resellerVisible: true e vendibile', () => {
  const result = expectOk(resolveAuthoritativeLines([
    line({ productId: 2, productSlug: 'kit-test', variantSku: 'KIT-OFF', unitPrice: 9.99, priceTiers: [], qty: 2 }),
  ], kitCatalog()))
  assert.equal(result.lines[0].unitPrice, 9.99)
  assert.equal(result.lines[0].lineTotalCents, 1998)
  assert.equal(result.productsTotalCents, 1998)
})

test('prodotto con active: false e prezzo manomesso: 400 prezzo_non_allineato', () => {
  expectError(resolveAuthoritativeLines([
    line({ productId: 2, productSlug: 'kit-test', variantSku: 'KIT-OFF', unitPrice: 0.01, priceTiers: [], qty: 2 }),
  ], kitCatalog()), 400, 'prezzo_non_allineato')
})

test('prodotto con resellerVisible: false: 400 prodotto_non_disponibile', () => {
  expectError(resolveAuthoritativeLines([line()], [catalogProduct({ resellerVisible: false })]), 400, 'prodotto_non_disponibile')
})

test('productId discordante dallo SKU: 400 prodotto_non_disponibile', () => {
  expectError(resolveAuthoritativeLines([line({ productId: 999 })], catalog()), 400, 'prodotto_non_disponibile')
})

test('productId assente o non intero: 400 prodotto_non_valido', () => {
  const withoutId = line()
  delete withoutId.productId
  for (const productId of [undefined, null, '1', 1.5, {}, true]) {
    expectError(resolveAuthoritativeLines([line({ productId })], catalog()), 400, 'prodotto_non_valido')
  }
  expectError(resolveAuthoritativeLines([withoutId], catalog()), 400, 'prodotto_non_valido')
})

test('productSlug discordante dal catalogo: 400 prodotto_non_disponibile', () => {
  expectError(resolveAuthoritativeLines([line({ productSlug: 'altro-prodotto' })], catalog()), 400, 'prodotto_non_disponibile')
})

// --- quantita ---------------------------------------------------------------

test('qty non intera, non positiva o oltre il tetto: 400 quantita_non_valida', () => {
  for (const qty of [-10, 0, 1.5, '3', null, undefined, NaN, Infinity, 100001, true]) {
    expectError(resolveAuthoritativeLines([line({ qty })], catalog()), 400, 'quantita_non_valida')
  }
})

test('qty 1 e qty 100000 sono valide', () => {
  expectOk(resolveAuthoritativeLines([line({ qty: 1 })], catalog()))
  const result = expectOk(resolveAuthoritativeLines([line({ qty: 100000 })], catalog()))
  // 14,99 -30% x 100000 = 1049300 EUR
  assert.equal(result.lines[0].lineTotalCents, 104930000)
})

// --- prezzo del client ------------------------------------------------------

test('unitPrice non numerico o negativo: 400 prezzo_non_valido', () => {
  for (const unitPrice of ['0.01', 'abc', null, undefined, NaN, Infinity, -0.01, {}]) {
    expectError(resolveAuthoritativeLines([line({ unitPrice })], catalog()), 400, 'prezzo_non_valido')
  }
})

test('unitPrice discordante dal catalogo: 400 prezzo_non_allineato', () => {
  expectError(resolveAuthoritativeLines([line({ unitPrice: 0.01 })], catalog()), 400, 'prezzo_non_allineato')
  // Un centesimo di scarto e' discordante: nessuna tolleranza.
  expectError(resolveAuthoritativeLines([line({ unitPrice: 14.98 })], catalog()), 400, 'prezzo_non_allineato')
})

test('unitPrice con frazioni di centesimo: 400 prezzo_non_valido', () => {
  // 14.989 arrotondato a 14.99 non e' "lo stesso prezzo": e' un importo
  // diverso che il client non ha titolo a inventare.
  for (const unitPrice of [14.989, 14.991, 0.001]) {
    expectError(resolveAuthoritativeLines([line({ unitPrice })], catalog()), 400, 'prezzo_non_valido')
  }
})

// --- fasce del client -------------------------------------------------------

test('priceTiers assente o non array: 400 fasce_non_valide', () => {
  const without = line()
  delete without.priceTiers
  for (const priceTiers of [undefined, null, 'niente', {}, 3]) {
    expectError(resolveAuthoritativeLines([line({ priceTiers })], catalog()), 400, 'fasce_non_valide')
  }
  expectError(resolveAuthoritativeLines([without], catalog()), 400, 'fasce_non_valide')
})

test('priceTiers discordanti: 400 fasce_non_allineate', () => {
  const mismatches: unknown[] = [
    [{ minQty: 10, maxQty: 49, discountPercent: 99.9 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    [{ minQty: 50, maxQty: null, discountPercent: 30 }, { minQty: 10, maxQty: 49, discountPercent: 20 }],
    [{ minQty: 10, maxQty: 49, discountPercent: 20 }],
    [{ minQty: 10, maxQty: 48, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    [{ minQty: 10, maxQty: 49, discountPercent: 20 + 1e-9 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    [{ minQty: '10', maxQty: 49, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    [{ minQty: 10, maxQty: 49, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }, { minQty: 90, maxQty: null, discountPercent: 40 }],
    [null, { minQty: 50, maxQty: null, discountPercent: 30 }],
  ]
  for (const priceTiers of mismatches) {
    expectError(resolveAuthoritativeLines([line({ priceTiers })], catalog()), 400, 'fasce_non_allineate')
  }
})

// --- catalogo invalido ------------------------------------------------------

test('catalogo non array: 503 catalogo_non_valido', () => {
  for (const broken of [null, undefined, {}, 'catalogo', 42]) {
    expectError(resolveAuthoritativeLines([line()], broken), 503, 'catalogo_non_valido')
  }
})

test('prezzo di variante invalido: 503 catalogo_non_valido', () => {
  for (const price of [null, '14.99', -1, NaN, Infinity, 0.001]) {
    const product = catalogProduct({ variants: [{ sku: 'ST-14', label: '14 cm', price }] })
    expectError(resolveAuthoritativeLines([line()], [product]), 503, 'catalogo_non_valido')
  }
})

test('fasce con discountPercent fuori [0,100]: 503 catalogo_non_valido', () => {
  for (const discountPercent of [120, -1, null, '20', NaN]) {
    const product = catalogProduct({ priceTiers: [{ minQty: 10, maxQty: null, discountPercent }] })
    expectError(resolveAuthoritativeLines([line({ priceTiers: [] })], [product]), 503, 'catalogo_non_valido')
  }
})

test('fasce con minQty/maxQty invalidi: 503 catalogo_non_valido', () => {
  const broken = [
    [{ minQty: 0, maxQty: null, discountPercent: 20 }],
    [{ minQty: 1.5, maxQty: null, discountPercent: 20 }],
    [{ minQty: '10', maxQty: null, discountPercent: 20 }],
    [{ minQty: 10, maxQty: 9, discountPercent: 20 }],
    [{ minQty: 10, maxQty: 1.5, discountPercent: 20 }],
    [{ minQty: 10, maxQty: 0, discountPercent: 20 }],
  ]
  for (const priceTiers of broken) {
    expectError(resolveAuthoritativeLines([line({ priceTiers })], [catalogProduct({ priceTiers })]), 503, 'catalogo_non_valido')
  }
})

test('fasce sovrapposte o non ordinate: 503 catalogo_non_valido', () => {
  const broken = [
    // sovrapposizione: la seconda banda rientra nella prima
    [{ minQty: 10, maxQty: 60, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    // fascia aperta seguita da un'altra: anch'essa sovrapposta
    [{ minQty: 10, maxQty: null, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
    // ordine decrescente
    [{ minQty: 50, maxQty: null, discountPercent: 30 }, { minQty: 10, maxQty: 49, discountPercent: 20 }],
    // stesso minQty
    [{ minQty: 10, maxQty: 20, discountPercent: 20 }, { minQty: 10, maxQty: 49, discountPercent: 30 }],
  ]
  for (const priceTiers of broken) {
    expectError(resolveAuthoritativeLines([line({ priceTiers })], [catalogProduct({ priceTiers })]), 503, 'catalogo_non_valido')
  }
})

test('fasce adiacenti senza sovrapposizione sono valide', () => {
  const product = catalogProduct({
    priceTiers: [{ minQty: 1, maxQty: 9, discountPercent: 5 }, { minQty: 10, maxQty: 49, discountPercent: 20 }, { minQty: 50, maxQty: null, discountPercent: 30 }],
  })
  const result = expectOk(resolveAuthoritativeLines([
    line({ priceTiers: product.priceTiers }),
  ], [product]))
  // qty 1 ricade nella prima fascia: 14,99 -5% = 14,2405 -> 1424 centesimi
  assert.equal(result.lines[0].lineTotalCents, 1424)
})

// --- ordine dei controlli ---------------------------------------------------

test('un errore del client viene prima della validazione del catalogo', () => {
  const product = catalogProduct({ priceTiers: [{ minQty: 10, maxQty: null, discountPercent: 120 }] })
  expectError(resolveAuthoritativeLines([line({ qty: 0, priceTiers: [] })], [product]), 400, 'quantita_non_valida')
})

test('catalogo invalido prevale sulla discordanza prezzo', () => {
  const product = catalogProduct({ variants: [{ sku: 'ST-14', label: '14 cm', price: 0.001 }], priceTiers: [] })
  expectError(resolveAuthoritativeLines([line({ priceTiers: [] })], [product]), 503, 'catalogo_non_valido')
})

test('una riga non valida in mezzo a righe valide fa rifiutare tutto', () => {
  expectError(resolveAuthoritativeLines([
    line({ qty: 10 }),
    line({ priceTiers: [{ minQty: 10, maxQty: 49, discountPercent: 99.9 }, { minQty: 50, maxQty: null, discountPercent: 30 }] }),
    line(),
  ], catalog()), 400, 'fasce_non_allineate')
})

// --- disponibilita' della variante -----------------------------------------

test('variante stockStatus unavailable: 400 variante_non_disponibile', () => {
  const product = catalogProduct({
    variants: [{ sku: 'ST-14', label: '14 cm', price: 14.99, stockStatus: 'unavailable' }],
  })
  expectError(resolveAuthoritativeLines([line()], [product]), 400, 'variante_non_disponibile')
})

test('variante stockStatus low resta vendibile', () => {
  const product = catalogProduct({
    variants: [{ sku: 'ST-14', label: '14 cm', price: 14.99, stockStatus: 'low' }],
  })
  const result = expectOk(resolveAuthoritativeLines([line()], [product]))
  assert.equal(result.lines[0].variantSku, 'ST-14')
})

test('variante senza stockStatus resta vendibile', () => {
  const product = catalogProduct({
    variants: [{ sku: 'ST-14', label: '14 cm', price: 14.99 }],
  })
  expectOk(resolveAuthoritativeLines([line()], [product]))
})

test('active false + resellerVisible true + variante disponibile resta vendibile', () => {
  const result = expectOk(resolveAuthoritativeLines([
    line({ productId: 2, productSlug: 'kit-test', variantSku: 'KIT-OFF', unitPrice: 9.99, priceTiers: [], qty: 2 }),
  ], kitCatalog()))
  assert.equal(result.lines[0].lineTotalCents, 1998)
})
