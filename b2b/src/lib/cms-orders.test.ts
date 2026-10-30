import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createB2BOrder,
  toPayloadOrder,
  updateB2BPayment,
  type B2BOrderInput,
} from './cms-orders'

const input: B2BOrderInput = {
  orderNumber: 'B2B-2608-TEST',
  customerEmail: 'orders@example.com',
  customerName: 'Mario Rossi',
  vatNumber: 'IT12345678901',
  businessName: 'Rossi Tattoo Srl',
  sdiCode: '0000000',
  billingAddress1: 'Via Roma 1',
  billingCity: 'Torino',
  billingPostalCode: '10100',
  billingCountry: 'IT',
  shippingAddressName: 'Mario Rossi',
  shippingAddress1: 'Via Roma 1',
  shippingCity: 'Torino',
  shippingPostalCode: '10100',
  shippingCountry: 'IT',
  lineItems: [{
    productName: 'Stencil',
    variantSku: 'ST-01',
    variantLabel: 'Grande',
    qty: 2,
    unitPrice: 10,
    priceTiers: [],
  }],
  total: 25,
  shippingCost: 5,
  paymentMethod: 'stripe',
  notes: 'Consegna al mattino',
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('B2B orders use Payload fields and normalize line items for CMS hooks', () => {
  assert.deepEqual(toPayloadOrder(input), {
    orderNumber: 'B2B-2608-TEST',
    source: 'reseller',
    customerEmail: 'orders@example.com',
    customerName: 'Mario Rossi',
    lineItems: [{
      sku: 'ST-01',
      name: 'Stencil',
      variantLabel: 'Grande',
      quantity: 2,
      unitPrice: 10,
      lineTotalCents: 2000,
    }],
    total: 25,
    shippingCost: 5,
    shippingAddress: {
      name: 'Mario Rossi',
      address1: 'Via Roma 1',
      city: 'Torino',
      postalCode: '10100',
      country: 'IT',
    },
    billingSameAsShipping: false,
    billingCompanyName: 'Rossi Tattoo Srl',
    billingVatNumber: 'IT12345678901',
    billingSdiCode: '0000000',
    billingAddress: {
      name: 'Rossi Tattoo Srl',
      address1: 'Via Roma 1',
      city: 'Torino',
      postalCode: '10100',
      country: 'IT',
    },
    notes: 'Consegna al mattino',
    pipelineState: 'received',
    paymentMethod: 'stripe',
    paymentStatus: 'pending',
  })
})

test('a concurrent Payload create race is resolved by orderNumber without a second order', async () => {
  const calls: Array<{ url: string; method: string }> = []
  let lookupCount = 0
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' })
    if (!init?.method) {
      lookupCount += 1
      return lookupCount === 1
        ? response({ docs: [] })
        : response({ docs: [{ id: 44, orderNumber: input.orderNumber }] })
    }
    return response({ error: 'duplicate orderNumber' }, 400)
  }

  const result = await createB2BOrder(input, fetchImpl)

  assert.equal(result.created, false)
  assert.equal(result.orderId, 44)
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
})

test('Stripe retry updates the existing Payload order through PATCH and stores structured payment state', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body?.toString() })
    if (!init?.method) return response({ docs: [{ id: 44, orderNumber: input.orderNumber }] })
    return response({ id: 44, orderNumber: input.orderNumber, paymentStatus: 'paid' })
  }

  await updateB2BPayment({
    orderNumber: input.orderNumber,
    paymentIntentId: 'pi_123',
  }, fetchImpl)

  const patch = calls.find(call => call.method === 'PATCH')
  assert.ok(patch)
  assert.equal(patch.url, 'http://localhost:3001/api/orders/44')
  assert.deepEqual(JSON.parse(patch.body ?? '{}'), {
    paymentStatus: 'paid',
    stripePaymentIntentId: 'pi_123',
  })
})


// --- invariant: riga CMS e totale ordine non divergono ----------------------

test('50 pezzi a 8.125: unitPrice esatto, lineTotalCents 40625, email 406.25', () => {
  const payload = toPayloadOrder({
    ...input,
    lineItems: [{
      productName: 'Stencil',
      variantSku: 'ST-01',
      variantLabel: 'Grande',
      qty: 50,
      unitPrice: 10,
      priceTiers: [{ minQty: 50, maxQty: null, discountPercent: 18.75 }],
    }],
    total: 406.25,
    shippingCost: 0,
  })
  const item = (payload.lineItems as Array<Record<string, number>>)[0]
  assert.equal(item.unitPrice, 8.125)
  assert.equal(item.quantity, 50)
  assert.equal(item.lineTotalCents, 40625)
  assert.equal(item.unitPrice * item.quantity, 406.25)
  assert.equal(Math.round(item.unitPrice * item.quantity * 100), item.lineTotalCents)
  assert.equal((item.unitPrice * item.quantity).toFixed(2), '406.25')
  assert.equal(Number((item.unitPrice * item.quantity).toFixed(2)), payload.total)
})

test('una riga da 0.01 con fascia 50% vale un centesimo, non zero', () => {
  const payload = toPayloadOrder({
    ...input,
    lineItems: [{
      productName: 'Stencil',
      variantSku: 'ST-01',
      variantLabel: 'Grande',
      qty: 1,
      unitPrice: 0.01,
      priceTiers: [{ minQty: 1, maxQty: null, discountPercent: 50 }],
    }],
    total: 0.01,
    shippingCost: 0,
  })
  const item = (payload.lineItems as Array<Record<string, number>>)[0]
  assert.equal(item.lineTotalCents, 1)
  assert.equal(Math.round(item.unitPrice * item.quantity * 100), item.lineTotalCents)
})

test('due righe da 0.01 al 50% sommano 2 centesimi di prodotti', () => {
  const line = {
    productName: 'Stencil',
    variantSku: 'ST-01',
    variantLabel: 'Grande',
    qty: 1,
    unitPrice: 0.01,
    priceTiers: [{ minQty: 1, maxQty: null, discountPercent: 50 }],
  }
  const payload = toPayloadOrder({
    ...input,
    lineItems: [line, line],
    total: 0.02,
    shippingCost: 0,
  })
  const items = payload.lineItems as Array<Record<string, number>>
  assert.equal(items.reduce((sum, item) => sum + item.lineTotalCents, 0), 2)
})
