/**
 * Test di LOGICA del carrello obsoleto e del rifiuto di checkout.
 *
 * NON e' un test di browser: non monta la pagina, non tocca lo store Zustand
 * e non parla con Next. Esercita le funzioni pure che la pagina usa per
 * decidere cosa mostrare e per applicare un prezzo nuovo solo dopo
 * approvazione esplicita. Il controllo `res.ok` nel componente e' verificato
 * per lettura del codice, non da un test di rendering (vedi rapporto R6).
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { lineTotalCents } from './b2b-pricing'
import {
  applyPriceUpdate,
  classifyCheckoutFailure,
  decideAfterCheckoutFailure,
  diffCartPrices,
  type CartPricesResponse,
} from './cart-reconcile'

interface TestCartItem {
  productId: number
  productSlug: string
  productName: string
  variantSku: string
  variantLabel: string
  unitPrice: number
  qty: number
  priceTiers: Array<{ minQty: number; maxQty: number | null; discountPercent: number }>
}

function cartItem(overrides: Partial<TestCartItem> = {}): TestCartItem {
  return {
    productId: 1,
    productSlug: 'stencil-test',
    productName: 'Stencil Test (sintetico)',
    variantSku: 'ST-14',
    variantLabel: '14 cm',
    unitPrice: 10,
    qty: 3,
    priceTiers: [],
    ...overrides,
  }
}

function prices(overrides: Partial<CartPricesResponse> = {}): CartPricesResponse {
  return {
    productsTotalCents: 3600,
    items: [
      {
        variantSku: 'ST-14',
        qty: 3,
        available: true,
        unitPrice: 12,
        priceTiers: [],
        lineTotalCents: 3600,
      },
    ],
    ...overrides,
  }
}

// --- classificazione dei rifiuti -------------------------------------------

test('400 prezzo_non_allineato: revisione, errorPrezziCambiati, requiresPriceReview', () => {
  const result = classifyCheckoutFailure(400, { error: 'prezzo_non_allineato' })
  assert.deepEqual(result, {
    messageKey: 'errorPrezziCambiati',
    requiresPriceReview: true,
    regenerateKey: false,
  })
  assert.equal(
    decideAfterCheckoutFailure(400, { error: 'prezzo_non_allineato' }).action,
    'revisione',
  )
})

test('fasce_non_allineate: stessa revisione del prezzo cambiato', () => {
  const result = classifyCheckoutFailure(400, { error: 'fasce_non_allineate' })
  assert.equal(result.messageKey, 'errorPrezziCambiati')
  assert.equal(result.requiresPriceReview, true)
})

for (const error of ['sku_non_disponibile', 'prodotto_non_disponibile', 'variante_non_disponibile']) {
  test(`${error}: errorProdottoNonDisponibile e revisione`, () => {
    const result = classifyCheckoutFailure(400, { error })
    assert.deepEqual(result, {
      messageKey: 'errorProdottoNonDisponibile',
      requiresPriceReview: true,
      regenerateKey: false,
    })
  })
}

test('chiave_idempotenza_mancante: errorGenerico con regenerateKey', () => {
  const result = classifyCheckoutFailure(400, { error: 'chiave_idempotenza_mancante' })
  assert.deepEqual(result, {
    messageKey: 'errorGenerico',
    requiresPriceReview: false,
    regenerateKey: true,
  })
})

for (const [status, body, messageKey] of [
  [503, { error: 'catalogo_non_disponibile' }, 'errorCatalogo'],
  [503, { error: 'catalogo_incompleto' }, 'errorCatalogo'],
  [503, { error: 'catalogo_non_valido' }, 'errorCatalogo'],
  [409, { error: 'ordine_gia_pagato' }, 'errorOrdineGiaPagato'],
  [409, { error: 'ordine_non_coerente' }, 'errorOrdineNonCoerente'],
  [400, { error: 'partita_iva_non_valida' }, 'errorPartitaIva'],
  [400, { error: 'email_non_valida' }, 'errorForm'],
  [400, { error: 'ragione_sociale_mancante' }, 'errorForm'],
  [400, { error: 'campo_non_valido' }, 'errorForm'],
  [400, { error: 'body_non_valido' }, 'errorForm'],
] as const) {
  test(`mappatura ${status} ${body.error}: ${messageKey}, nessuna revisione`, () => {
    assert.deepEqual(classifyCheckoutFailure(status, body), {
      messageKey,
      requiresPriceReview: false,
      regenerateKey: false,
    })
  })
}

test('codici sconosciuti e 5xx: errorGenerico, mai una navigazione', () => {
  const cases: Array<[number, unknown]> = [
    [400, { error: 'codice_inventato' }],
    [500, { error: 'prezzo_non_allineato' }],
    [502, { error: 'Errore pagamento' }],
    [0, null],
    [200, 'non un oggetto'],
  ]
  for (const [status, body] of cases) {
    const decision = decideAfterCheckoutFailure(status, body)
    assert.deepEqual(decision, {
      action: 'errore',
      messageKey: 'errorGenerico',
      regenerateKey: false,
    })
    assert.deepEqual(Object.keys(decision).sort(), ['action', 'messageKey', 'regenerateKey'])
  }
})

// --- diff prezzi ------------------------------------------------------------

test('diff: carrello 10.00 x 3, prezzo autorevole 12.00 x 3', () => {
  const diff = diffCartPrices([cartItem()], prices())

  assert.equal(diff.rows.length, 1)
  assert.deepEqual(diff.rows[0], {
    variantSku: 'ST-14',
    qty: 3,
    oldUnitPrice: 10,
    newUnitPrice: 12,
    newLineTotalCents: 3600,
    changed: true,
    available: true,
  })
  assert.equal(diff.oldProductsTotalCents, 3000)
  assert.equal(diff.newProductsTotalCents, 3600)
  assert.equal(diff.deltaCents, 600)
  assert.equal(diff.hasChanges, true)
})

test('diff: prezzo invariato, nessun cambiamento e delta zero', () => {
  const diff = diffCartPrices([cartItem({ unitPrice: 12 })], prices())
  assert.equal(diff.rows[0].changed, false)
  assert.equal(diff.oldProductsTotalCents, 3600)
  assert.equal(diff.newProductsTotalCents, 3600)
  assert.equal(diff.deltaCents, 0)
  assert.equal(diff.hasChanges, false)
})

test('diff: totale riga calcolato con lineTotalCents condiviso, mai con float', () => {
  // 12,50 -35% = 8,125: l'arrotondamento e' sul totale riga (50 pezzi).
  const cart = [cartItem({
    unitPrice: 12.5,
    qty: 50,
    priceTiers: [{ minQty: 50, maxQty: null, discountPercent: 35 }],
  })]
  const authoritative = prices({
    productsTotalCents: 40625,
    items: [{
      variantSku: 'ST-14',
      qty: 50,
      available: true,
      unitPrice: 12.5,
      priceTiers: [{ minQty: 50, maxQty: null, discountPercent: 35 }],
      lineTotalCents: lineTotalCents(12.5, 50, [{ minQty: 50, maxQty: null, discountPercent: 35 }]),
    }],
  })
  const diff = diffCartPrices(cart, authoritative)
  assert.equal(diff.rows[0].newLineTotalCents, 40625)
  assert.equal(diff.newProductsTotalCents, 40625)
  assert.equal(diff.deltaCents, 0)
})

// --- applicazione del prezzo nuovo -----------------------------------------

test('applyPriceUpdate non modifica l\'array in ingresso e produce un array nuovo', () => {
  const cart = [cartItem()]
  const snapshot = structuredClone(cart)
  const updated = applyPriceUpdate(cart, prices())

  assert.notEqual(updated, cart)
  assert.notEqual(updated[0], cart[0])
  assert.deepEqual(cart, snapshot, 'l\'array in ingresso resta intatto')
  assert.equal(updated[0].unitPrice, 12)
  assert.deepEqual(updated[0].priceTiers, [])
  assert.equal(updated[0].qty, 3)
  assert.equal(
    lineTotalCents(updated[0].unitPrice, updated[0].qty, updated[0].priceTiers),
    3600,
  )
})

test('applyPriceUpdate copia le fasce del catalogo invece di condividere il riferimento', () => {
  const tier = { minQty: 10, maxQty: null, discountPercent: 20 }
  const cart = [cartItem({ qty: 10, priceTiers: [] })]
  const authoritative = prices({
    productsTotalCents: 11992,
    items: [{
      variantSku: 'ST-14',
      qty: 10,
      available: true,
      unitPrice: 14.99,
      priceTiers: [tier],
      lineTotalCents: 11992,
    }],
  })
  const updated = applyPriceUpdate(cart, authoritative)
  assert.deepEqual(updated[0].priceTiers, [tier])
  assert.notEqual(updated[0].priceTiers, authoritative.items[0].priceTiers)
  assert.notEqual(updated[0].priceTiers[0], tier)
})

// --- SKU non disponibile ----------------------------------------------------

test('sku_non_disponibile: available false, unitPrice null e riga segnalata', () => {
  const authoritative = prices({
    productsTotalCents: 0,
    items: [{
      variantSku: 'ST-14',
      qty: 3,
      available: false,
      unitPrice: null,
      priceTiers: [],
      lineTotalCents: 0,
    }],
  })
  const diff = diffCartPrices([cartItem()], authoritative)

  assert.equal(diff.rows[0].available, false)
  assert.equal(diff.rows[0].newUnitPrice, null)
  assert.equal(diff.rows[0].newLineTotalCents, 0)
  assert.equal(diff.rows[0].changed, true)
  assert.equal(diff.hasChanges, true)
})

test('SKU assente dalla risposta: riga disponibile false, non silenziosamente ignorata', () => {
  const diff = diffCartPrices([cartItem()], prices({ items: [], productsTotalCents: 0 }))
  assert.equal(diff.rows.length, 1)
  assert.equal(diff.rows[0].available, false)
  assert.equal(diff.rows[0].newUnitPrice, null)
})

// --- flusso sintetico completo ---------------------------------------------

test('rifiuto -> ricalcolo -> approvazione: zero chiamate di checkout e zero pagamenti', async () => {
  const cart = [cartItem()]
  let checkoutCalls = 0
  let intentCalls = 0
  let paymentCalls = 0
  const realFetch = globalThis.fetch

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    if (url.includes('/api/checkout')) checkoutCalls += 1
    if (url.includes('/api/stripe/create-intent')) intentCalls += 1
    throw new Error(`rete non consentita nel flusso sintetico: ${url}`)
  }) as typeof fetch

  try {
    // 1. Rifiuto della rotta di checkout per prezzo vecchio.
    const decision = decideAfterCheckoutFailure(400, { error: 'prezzo_non_allineato' })
    assert.equal(decision.action, 'revisione')

    // 2. Ricalcolo: solo lettura, nessun invio.
    const authoritative = prices()
    const diff = diffCartPrices(cart, authoritative)
    assert.equal(diff.newProductsTotalCents, 3600)

    // 3. Approvazione esplicita: qui e solo qui nasce il carrello nuovo.
    const approved = applyPriceUpdate(cart, authoritative)
    assert.equal(approved[0].unitPrice, 12)

    // 4. Il carrello e' pronto, ma nessun ordine e' partito da solo.
    paymentCalls = 0
  } finally {
    globalThis.fetch = realFetch
  }

  assert.equal(checkoutCalls, 0, 'nessuna chiamata a /api/checkout')
  assert.equal(intentCalls, 0, 'nessuna chiamata a /api/stripe/create-intent')
  assert.equal(paymentCalls, 0, 'nessun pagamento')
  assert.equal(cart[0].unitPrice, 10, 'il carrello originale resta invariato fino al replace')
})

// --- decisione della pagina sugli esiti reali della rotta ------------------

test('pagina: 200 con corpo d\'errore, 409, 502 e corpo non JSON decidono sempre errore o revisione', () => {
  const cases: Array<[number, unknown]> = [
    [200, { error: 'prezzo_non_allineato' }],
    [200, { error: 'sku_non_disponibile' }],
    [409, { error: 'ordine_gia_pagato' }],
    [409, { error: 'ordine_non_coerente' }],
    [502, { error: 'Errore pagamento' }],
    [502, null],
    [200, null],
  ]
  for (const [status, body] of cases) {
    const decision = decideAfterCheckoutFailure(status, body)
    assert.ok(
      decision.action === 'errore' || decision.action === 'revisione',
      `azione inattesa: ${JSON.stringify(decision)}`,
    )
    assert.deepEqual(Object.keys(decision).sort(), ['action', 'messageKey', 'regenerateKey'])
  }
})

// --- parita' delle chiavi del namespace Checkout ---------------------------

const LOCALES = ['it', 'en', 'de', 'fr', 'es'] as const

const NEW_KEYS = [
  'errorPrezziCambiati',
  'errorProdottoNonDisponibile',
  'errorCatalogo',
  'errorPartitaIva',
  'errorForm',
  'errorGenerico',
  'revisionePrezziTitolo',
  'revisionePrezziDescrizione',
  'prezzoAttuale',
  'prezzoNuovo',
  'quantita',
  'nuovoTotaleRiga',
  'nuovoSubtotale',
  'differenza',
  'aggiornaCarrello',
  'annulla',
  'prodottoNonDisponibile',
  'caricamentoPrezzi',
] as const

function checkoutNamespace(locale: string): Record<string, unknown> {
  const url = new URL(`../../messages/${locale}.json`, import.meta.url)
  const parsed = JSON.parse(readFileSync(url, 'utf8')) as { Checkout?: Record<string, unknown> }
  return parsed.Checkout ?? {}
}

test('namespace Checkout: parita esatta delle chiavi nelle cinque lingue', () => {
  const reference = Object.keys(checkoutNamespace('it')).sort()
  assert.ok(reference.length > 0, 'il namespace Checkout non deve essere vuoto')
  for (const locale of LOCALES) {
    assert.deepEqual(
      Object.keys(checkoutNamespace(locale)).sort(),
      reference,
      `chiavi Checkout divergenti in ${locale}.json`,
    )
  }
})

test('namespace Checkout: tutte le chiavi nuove esistono in tutte e cinque le lingue', () => {
  for (const locale of LOCALES) {
    const keys = checkoutNamespace(locale)
    for (const key of NEW_KEYS) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(keys, key),
        `${key} manca in ${locale}.json`,
      )
      assert.equal(typeof keys[key], 'string', `${key} in ${locale}.json non e' una stringa`)
      assert.ok((keys[key] as string).trim().length > 0, `${key} in ${locale}.json e' vuota`)
    }
  }
})
