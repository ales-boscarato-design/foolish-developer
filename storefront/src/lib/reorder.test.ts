import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildReorderCheckoutSessionParams,
  buildReorderPlan,
  SHIPPING_LINE_NAME,
  sourceOrderCountry,
  type ReorderPlan,
} from './reorder'
import { calculateServerShippingCostCents } from './promo'
import { calculateShipping } from './shipping'

const ACCOUNT_EMAIL = 'cliente@example.invalid'
const NOW = 1_789_994_290_000
const URLS = { successUrl: 'https://thefoolishbutcher.com/account/ordini?reorder=success', cancelUrl: 'https://thefoolishbutcher.com/account' }

/** Documento ordine come lo restituisce il CMS a `depth=0`. */
function orderDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    orderNumber: 'FOOLISH-1789930941341',
    customerEmail: ACCOUNT_EMAIL,
    customerName: 'Cliente Test',
    customerPhone: '+390000000000',
    lineItems: [
      { sku: 'TS-DUO-A4', name: 'T-Sheet Duoskin', variantLabel: 'A4', quantity: 1, unitPrice: 43.2 },
    ],
    shippingAddress: {
      name: 'Cliente Test',
      address1: 'Via Test 1',
      address2: '',
      city: 'Torino',
      postalCode: '10100',
      country: 'IT',
    },
    ...overrides,
  }
}

function planOf(order: unknown): ReorderPlan {
  const result = buildReorderPlan({ order, accountEmail: ACCOUNT_EMAIL, now: NOW })
  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') throw new Error('unreachable')
  return result.plan
}

function failureOf(order: unknown): string {
  const result = buildReorderPlan({ order, accountEmail: ACCOUNT_EMAIL, now: NOW })
  assert.equal(result.status, 'failed')
  if (result.status !== 'failed') throw new Error('unreachable')
  return result.reason
}

/** Centesimi delle righe prodotto e della riga spedizione della sessione. */
function sessionTotals(plan: ReorderPlan) {
  const params = buildReorderCheckoutSessionParams(plan, URLS)
  const lines = params.line_items ?? []
  let productsCents = 0
  let shippingCents = 0
  for (const line of lines) {
    const unitAmount = line.price_data?.unit_amount ?? 0
    const quantity = line.quantity ?? 0
    if (line.price_data?.product_data?.name === SHIPPING_LINE_NAME) shippingCents += unitAmount * quantity
    else productsCents += unitAmount * quantity
  }
  return { productsCents, shippingCents, lines }
}

test('un riordino IT addebita la tariffa della zona e la dichiara nei metadata', () => {
  const plan = planOf(orderDoc())

  assert.equal(plan.orderRef, `FOOLISH-${NOW}`)
  assert.equal(plan.sourceOrderNumber, 'FOOLISH-1789930941341')
  assert.equal(plan.destinationCountry, 'IT')
  // 43,20 € di merce: sotto la soglia di spedizione gratuita italiana (50 €).
  assert.equal(plan.shippingCostCents, 765)
  assert.equal(plan.metadata.shipping_cost_cents, '765')
  assert.equal(plan.metadata.order_ref, `FOOLISH-${NOW}`)
  assert.equal(plan.metadata.customer_country, 'IT')
  assert.equal(plan.metadata.customer_address, 'Via Test 1|Torino|10100')
  assert.equal(plan.metadata.reorder_from, 'FOOLISH-1789930941341')
  // Nessuna promo: un riordino non eredita sconti.
  assert.equal(plan.metadata.promo_code, undefined)

  const { productsCents, shippingCents, lines } = sessionTotals(plan)
  assert.equal(lines.length, 2)
  assert.equal(shippingCents, 765)
  // Il parser ricostruisce la spedizione dal residuo `amount_total - righe`: perche'
  // quel residuo sia la spedizione incassata, le righe prodotto di Stripe devono
  // valere esattamente `items_json`.
  const declaredItems = JSON.parse(plan.metadata.items_json) as Array<{ price: number; qty: number }>
  assert.equal(
    declaredItems.reduce((sum, item) => sum + Math.round(item.price * 100) * item.qty, 0),
    productsCents,
  )
})

test('la sessione di riordino raccoglie l\'indirizzo e non ammette altre destinazioni', () => {
  const plan = planOf(orderDoc({ shippingAddress: { ...orderDoc().shippingAddress, country: 'ch' } }))
  assert.equal(plan.destinationCountry, 'CH')

  const params = buildReorderCheckoutSessionParams(plan, URLS)
  assert.deepEqual(params.shipping_address_collection, { allowed_countries: ['CH'] })
  assert.equal(params.billing_address_collection, 'auto')
  assert.equal(params.mode, 'payment')
  assert.equal(params.customer_email, ACCOUNT_EMAIL)
  assert.equal(params.metadata, plan.metadata)
  assert.equal(params.success_url, URLS.successUrl)
  assert.equal(params.cancel_url, URLS.cancelUrl)
})

test('nessuna destinazione servita parte con spedizione sotto la tariffa pubblicata', () => {
  // 99 € di merce: la misura reale dello sdoganamento svizzero (47,72 €).
  const goods = 99
  const lineItems = [
    { sku: 'TS-DUO-A4', name: 'T-Sheet Duoskin', variantLabel: 'A4', quantity: 1, unitPrice: goods },
  ]
  const cart = [{ price: goods, quantity: 1, productName: 'T-Sheet Duoskin', variantLabel: 'A4', sku: 'TS-DUO-A4' }]

  for (const country of ['CH', 'GB', 'NO', 'US', 'CA', 'AU', 'JP', 'BR']) {
    const order = orderDoc({
      lineItems,
      shippingAddress: { ...orderDoc().shippingAddress, country },
    })
    const tariffCents = calculateServerShippingCostCents(cart, country, false)
    // Destinazione senza una misura di costo: la politica vigente è la
    // quotazione, non un prezzo indovinato.
    if (tariffCents === null) {
      assert.equal(failureOf(order), 'quotation_required', `${country}: dove non c'è una misura si quota`)
      continue
    }

    const plan = planOf(order)
    const rate = calculateShipping(goods, country) as {
      cost: number
      landedCost?: { estimatedCost: number }
    }
    assert.ok(plan.shippingCostCents > 0, `${country}: il riordino non può incassare 0 di trasporto`)
    assert.equal(plan.shippingCostCents, tariffCents, `${country}: tariffa diversa da shipping.ts`)
    // Extra-UE con costo sdoganato misurato: mai sotto la stima (stessa
    // disuguaglianza dei test di shipping.ts). Su `main` questa parte non ha
    // ancora una stima e non viene eseguita.
    if (rate.landedCost) {
      assert.ok(
        plan.shippingCostCents >= Math.round(rate.landedCost.estimatedCost * 100),
        `${country}: incassato ${plan.shippingCostCents} cent < costo stimato ${rate.landedCost.estimatedCost} €`,
      )
    }
  }
})

test('la spedizione gratuita non diventa una riga "Spedizione" da zero euro', () => {
  const plan = planOf(orderDoc({
    lineItems: [{ sku: 'TS-DUO-A4', name: 'T-Sheet Duoskin', variantLabel: 'A4', quantity: 1, unitPrice: 60 }],
  }))
  assert.equal(plan.shippingCostCents, 0)
  assert.equal(plan.metadata.shipping_cost_cents, '0')

  const { lines, shippingCents } = sessionTotals(plan)
  assert.equal(lines.length, 1)
  assert.equal(shippingCents, 0)
})

test('destinazione non determinabile: si quota invece di indovinare una tariffa', () => {
  for (const country of ['', 'ZZ', '  ']) {
    assert.equal(
      failureOf(orderDoc({ shippingAddress: { ...orderDoc().shippingAddress, country } })),
      'destination_unknown',
      `paese ${JSON.stringify(country)}`,
    )
  }
  assert.equal(failureOf(orderDoc({ shippingAddress: null })), 'destination_unknown')
  assert.equal(failureOf(orderDoc({ shippingAddress: { country: 'IT' } })), 'address_incomplete')
})

test('un ordine senza righe pagabili non diventa un carrello', () => {
  const base = orderDoc()
  assert.equal(failureOf(orderDoc({ lineItems: [] })), 'items_missing')
  assert.equal(failureOf(orderDoc({ lineItems: 'TS-DUO-A4' })), 'items_missing')
  // Omaggio abbonamento: prezzo zero, non è una riga che si può incassare.
  assert.equal(failureOf(orderDoc({
    lineItems: [{ sku: 'SUB-GIFT', name: 'Omaggio abbonamento', variantLabel: '', quantity: 1, unitPrice: 0 }],
  })), 'items_missing')
  assert.equal(failureOf(orderDoc({
    lineItems: [{ ...base.lineItems[0], quantity: 0 }],
  })), 'items_missing')
  assert.equal(failureOf(orderDoc({
    lineItems: [{ sku: 'TS-DUO-A4', name: 'T-Sheet Duoskin', variantLabel: 'A4', quantity: 1 }],
  })), 'items_missing')
})

test('un indirizzo incompleto non produce un ordine senza destinazione', () => {
  const base = orderDoc()
  assert.equal(failureOf(orderDoc({ customerName: '' })), 'address_incomplete')
  for (const field of ['address1', 'city', 'postalCode'] as const) {
    assert.equal(
      failureOf(orderDoc({ shippingAddress: { ...base.shippingAddress, [field]: '' } })),
      'address_incomplete',
      `campo ${field}`,
    )
  }
})

test('ordine inutilizzabile o troppo grande per i metadata', () => {
  assert.equal(failureOf(null), 'order_unusable')
  assert.equal(failureOf('FOOLISH-1'), 'order_unusable')
  assert.equal(failureOf(orderDoc({ orderNumber: '' })), 'order_unusable')

  const longItem = {
    sku: 's'.repeat(100),
    name: 'x'.repeat(120),
    variantLabel: 'v'.repeat(80),
    quantity: 1,
    unitPrice: 10,
  }
  assert.equal(failureOf(orderDoc({ lineItems: [longItem, { ...longItem, sku: 't'.repeat(100) }] })), 'order_too_large')
})

test('un ordine senza telefono (campo Payload vuoto) resta riordinabile', () => {
  // Payload restituisce `null` per un campo di testo vuoto: se diventasse una
  // stringa vuota il cliente risulterebbe incompleto e l'ordine non sarebbe
  // riordinabile, pur avendo un indirizzo di spedizione completo.
  for (const customerPhone of [null, undefined, '', '   ']) {
    const plan = planOf(orderDoc({ customerPhone }))
    assert.equal(plan.metadata.customer_phone, '', `telefono ${JSON.stringify(customerPhone)}`)
    assert.equal(plan.metadata.shipping_cost_cents, '765')
  }
  assert.equal(planOf(orderDoc()).metadata.customer_phone, '+390000000000')
})

test('il paese di partenza si legge normalizzato', () => {
  assert.equal(sourceOrderCountry({ shippingAddress: { country: ' de ' } }), 'DE')
  assert.equal(sourceOrderCountry({ shippingAddress: { country: 12 } }), null)
  assert.equal(sourceOrderCountry({}), null)
  assert.equal(sourceOrderCountry(null), null)
})

test('la tariffa del riordino è la stessa funzione del checkout', () => {
  const plan = planOf(orderDoc())
  const cart = [{ price: 43.2, quantity: 1, productName: 'T-Sheet Duoskin', variantLabel: 'A4', sku: 'TS-DUO-A4' }]
  assert.equal(plan.shippingCostCents, calculateServerShippingCostCents(cart, 'IT', false))
  assert.equal(plan.shippingCostCents, 765)
})
