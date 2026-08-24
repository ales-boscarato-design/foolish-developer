import { calculateLineTotal } from './pricing'

export type B2BPaymentMethod = 'bonifico' | 'stripe'

export interface B2BLineItemInput {
  productName: string
  variantSku: string
  variantLabel: string
  qty: number
  unitPrice: number
  priceTiers: { minQty: number; maxQty: number | null; discountPercent: number }[]
}

export interface B2BOrderInput {
  orderNumber: string
  customerEmail: string
  customerName: string
  vatNumber: string
  businessName: string
  sdiCode: string
  billingAddress1: string
  billingCity: string
  billingPostalCode: string
  billingCountry: string
  shippingAddressName: string
  shippingAddress1: string
  shippingCity: string
  shippingPostalCode: string
  shippingCountry: string
  lineItems: B2BLineItemInput[]
  total: number
  shippingCost: number
  paymentMethod: B2BPaymentMethod
  notes?: string
}

export interface CmsOrder {
  id: string | number
  orderNumber: string
  pipelineState?: string | null
  total?: number
  trackingNumber?: string | null
  createdAt?: string
  paymentStatus?: string | null
  stripePaymentIntentId?: string | null
}

interface CmsFindResponse {
  docs?: CmsOrder[]
}

const cmsUrl = () => process.env.CMS_URL || process.env.PAYLOAD_PUBLIC_URL || 'http://localhost:3001'

const cmsHeaders = () => ({
  'Content-Type': 'application/json',
  'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
})

function cmsOrderUrl(orderNumber: string): string {
  return `${cmsUrl()}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderNumber)}&limit=1&depth=0`
}

export function toPayloadOrder(input: B2BOrderInput): Record<string, unknown> {
  return {
    orderNumber: input.orderNumber,
    source: 'reseller',
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    lineItems: input.lineItems.map((item) => ({
      sku: item.variantSku,
      name: item.productName,
      variantLabel: item.variantLabel,
      quantity: item.qty,
      // Store the effective B2B unit price so CMS emails and admin totals
      // agree with the tiered price used to calculate the order total.
      unitPrice: item.qty > 0
        ? Math.round((calculateLineTotal(item.unitPrice, item.qty, item.priceTiers) / item.qty) * 100) / 100
        : 0,
    })),
    total: input.total,
    shippingCost: input.shippingCost,
    shippingAddress: {
      name: input.shippingAddressName,
      address1: input.shippingAddress1,
      city: input.shippingCity,
      postalCode: input.shippingPostalCode,
      country: input.shippingCountry,
    },
    billingSameAsShipping: false,
    billingCompanyName: input.businessName,
    billingVatNumber: input.vatNumber,
    billingSdiCode: input.sdiCode,
    billingAddress: {
      name: input.businessName,
      address1: input.billingAddress1,
      city: input.billingCity,
      postalCode: input.billingPostalCode,
      country: input.billingCountry,
    },
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    pipelineState: 'received',
    paymentMethod: input.paymentMethod,
    paymentStatus: 'pending',
  }
}

export async function findB2BOrder(
  orderNumber: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CmsOrder | null> {
  const response = await fetchImpl(cmsOrderUrl(orderNumber), {
    headers: cmsHeaders(),
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`CMS order lookup failed ${response.status}: ${await response.text()}`)
  }
  const data = await response.json() as CmsFindResponse
  return data.docs?.[0] ?? null
}

export async function createB2BOrder(
  input: B2BOrderInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ orderNumber: string; created: boolean; orderId: string | number }> {
  const existing = await findB2BOrder(input.orderNumber, fetchImpl)
  if (existing) {
    return { orderNumber: input.orderNumber, created: false, orderId: existing.id }
  }

  const response = await fetchImpl(`${cmsUrl()}/api/orders`, {
    method: 'POST',
    headers: cmsHeaders(),
    body: JSON.stringify(toPayloadOrder(input)),
  })

  if (!response.ok) {
    // The unique Payload field is the final arbiter when two requests race.
    // A retry must reuse the document that won the race, never create a second order.
    const racedOrder = await findB2BOrder(input.orderNumber, fetchImpl).catch(() => null)
    if (racedOrder) {
      return { orderNumber: input.orderNumber, created: false, orderId: racedOrder.id }
    }
    throw new Error(`CMS create order failed ${response.status}: ${await response.text()}`)
  }

  const created = await response.json() as CmsOrder
  return { orderNumber: input.orderNumber, created: true, orderId: created.id }
}

export async function updateB2BPayment(
  params: { orderNumber: string; paymentIntentId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CmsOrder> {
  const existing = await findB2BOrder(params.orderNumber, fetchImpl)
  if (!existing) {
    throw new Error(`CMS order ${params.orderNumber} not found for PaymentIntent ${params.paymentIntentId}`)
  }
  if (existing.stripePaymentIntentId && existing.stripePaymentIntentId !== params.paymentIntentId) {
    throw new Error(`CMS order ${params.orderNumber} is already linked to another PaymentIntent`)
  }

  const response = await fetchImpl(`${cmsUrl()}/api/orders/${encodeURIComponent(String(existing.id))}`, {
    method: 'PATCH',
    headers: cmsHeaders(),
    body: JSON.stringify({
      paymentStatus: 'paid',
      stripePaymentIntentId: params.paymentIntentId,
    }),
  })
  if (!response.ok) {
    throw new Error(`CMS payment update failed ${response.status}: ${await response.text()}`)
  }
  return await response.json() as CmsOrder
}

export async function findB2BOrdersByEmail(
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CmsOrder[]> {
  const url = `${cmsUrl()}/api/orders?where[customerEmail][equals]=${encodeURIComponent(email)}&where[source][equals]=reseller&sort=-createdAt&limit=50&depth=0`
  const response = await fetchImpl(url, { headers: cmsHeaders(), cache: 'no-store' })
  if (!response.ok) throw new Error(`CMS orders lookup failed ${response.status}: ${await response.text()}`)
  const data = await response.json() as CmsFindResponse
  return data.docs ?? []
}
