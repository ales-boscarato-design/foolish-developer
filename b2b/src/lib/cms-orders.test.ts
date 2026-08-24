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
