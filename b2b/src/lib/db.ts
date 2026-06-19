import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 5 })

export default sql

export interface ProMember {
  id: number
  email: string
  business_name: string
  contact_name: string
  vat_number: string
  status: 'active' | 'suspended'
  discount_code: string
  total_spent: number
  order_count: number
}

export async function findProMemberByEmail(email: string): Promise<ProMember | null> {
  const rows = await sql<ProMember[]>`
    SELECT id, email, business_name, contact_name, vat_number, status, discount_code, total_spent, order_count
    FROM pro_members
    WHERE email = ${email}
    LIMIT 1
  `
  return rows[0] ?? null
}

export interface ResellerOrder {
  id: number
  order_number: string
  total: number
  pipeline_state: string
  created_at: Date
  tracking_number: string | null
}

export async function getResellerOrders(email: string): Promise<ResellerOrder[]> {
  return sql<ResellerOrder[]>`
    SELECT id, order_number, total, pipeline_state, created_at, tracking_number
    FROM orders
    WHERE customer_email = ${email}
      AND source = 'reseller'
    ORDER BY created_at DESC
    LIMIT 50
  `
}

export interface CreateOrderInput {
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
  lineItems: unknown[]
  total: number
  shippingCost: number
  paymentMethod: string
  notes?: string
}

export async function createResellerOrder(input: CreateOrderInput): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO orders (
      order_number, customer_email, customer_name, source,
      billing_vat_number, billing_company_name, billing_sdi_code,
      billing_address_name, billing_address_address1, billing_address_city,
      billing_address_postal_code, billing_address_country,
      shipping_address_name, shipping_address_address1, shipping_address_city,
      shipping_address_postal_code, shipping_address_country,
      line_items, total, shipping_cost, notes, pipeline_state,
      updated_at, created_at
    ) VALUES (
      ${input.orderNumber}, ${input.customerEmail}, ${input.customerName}, 'reseller',
      ${input.vatNumber}, ${input.businessName}, ${input.sdiCode},
      ${input.businessName}, ${input.billingAddress1}, ${input.billingCity},
      ${input.billingPostalCode}, ${input.billingCountry},
      ${input.shippingAddressName}, ${input.shippingAddress1}, ${input.shippingCity},
      ${input.shippingPostalCode}, ${input.shippingCountry},
      ${JSON.stringify(input.lineItems)}, ${input.total}, ${input.shippingCost},
      ${(input.notes ? input.notes + ' — ' : '') + `Pagamento: ${input.paymentMethod}`}, 'received',
      NOW(), NOW()
    )
    RETURNING id
  `
  return rows[0].id
}
