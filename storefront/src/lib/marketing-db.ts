import sql from './db'

export type EmailType = 'welcome' | 'abandoned_cart' | 'review_request' | 'reengagement'

export interface Subscriber {
  id: string
  email: string
  name: string | null
  locale: string
  status: string
  purchase_count: number
  total_spent: number
  last_purchase_at: Date | null
}

export interface AbandonedCart {
  id: string
  email: string
  cart_data: unknown
  checkout_started_at: Date
}

export interface OrderForReview {
  id: string // Payload CMS order id (integer → string)
  customer_email: string
  customer_name: string | null
  subscriber_status: string | null
  product_id: number | null
  product_slug: string | null
}

// Upsert subscriber from a purchase. Returns { id, isNew }.
// isNew = true when purchase_count was 0 before this upsert (→ send welcome email).
export async function upsertSubscriber(params: {
  email: string
  name: string | null
  locale: string
  amountEur: number
}): Promise<{ id: string; isNew: boolean }> {
  const { email, name, locale, amountEur } = params

  const rows = await sql<{ id: string; purchase_count: number }[]>`
    INSERT INTO marketing.subscribers (email, name, locale, source, purchase_count, total_spent, last_purchase_at)
    VALUES (${email}, ${name}, ${locale}, 'purchase', 1, ${amountEur}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name            = COALESCE(EXCLUDED.name, marketing.subscribers.name),
      purchase_count  = marketing.subscribers.purchase_count + 1,
      total_spent     = marketing.subscribers.total_spent + ${amountEur},
      last_purchase_at = NOW(),
      updated_at      = NOW()
    RETURNING id, purchase_count
  `

  const row = rows[0]
  // isNew = true when purchase_count is exactly 1 after upsert
  return { id: row.id, isNew: row.purchase_count === 1 }
}

// Upsert cart session — one open session per email (latest wins).
export async function saveCartSession(email: string, cartData: unknown): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = sql.json(cartData as any)
  // Update existing open session first
  const updated = await sql<{ id: string }[]>`
    UPDATE marketing.cart_sessions
    SET cart_data = ${json},
        checkout_started_at = NOW()
    WHERE email = ${email}
      AND email_sent_at IS NULL
      AND recovered_at IS NULL
    RETURNING id
  `
  // No open session exists — insert a new one
  if (updated.length === 0) {
    await sql`
      INSERT INTO marketing.cart_sessions (email, cart_data, checkout_started_at)
      VALUES (${email}, ${json}, NOW())
    `
  }
}

// Mark cart as recovered (purchase completed).
export async function markCartSessionRecovered(email: string): Promise<void> {
  await sql`
    UPDATE marketing.cart_sessions
    SET recovered_at = NOW()
    WHERE email = ${email}
      AND recovered_at IS NULL
  `
}

// Log an email send.
export async function logEmail(params: {
  email: string
  type: EmailType
  resendId: string
  subscriberId?: string
}): Promise<void> {
  const { email, type, resendId, subscriberId } = params
  await sql`
    INSERT INTO marketing.email_log (email, type, resend_id, subscriber_id)
    VALUES (${email}, ${type}, ${resendId}, ${subscriberId ?? null})
  `
}

// Abandoned carts: started 1+ hour ago, no email sent, not recovered.
export async function getAbandonedCarts(): Promise<AbandonedCart[]> {
  return sql<AbandonedCart[]>`
    SELECT id, email, cart_data, checkout_started_at
    FROM marketing.cart_sessions
    WHERE checkout_started_at <= NOW() - INTERVAL '1 hour'
      AND email_sent_at IS NULL
      AND recovered_at IS NULL
      AND email IS NOT NULL
  `
}

// Mark abandoned cart email as sent.
export async function markCartEmailSent(id: string): Promise<void> {
  await sql`
    UPDATE marketing.cart_sessions
    SET email_sent_at = NOW()
    WHERE id = ${id}
  `
}

// Check if subscriber is blocked (unsubscribed or bounced).
export async function isSubscriberBlocked(email: string): Promise<boolean> {
  const rows = await sql<{ status: string }[]>`
    SELECT status FROM marketing.subscribers WHERE email = ${email} LIMIT 1
  `
  if (rows.length === 0) return false
  return rows[0].status === 'unsubscribed' || rows[0].status === 'bounced'
}

// Orders delivered 7+ days ago with no review email, customer not blocked.
// product_id and product_slug are resolved via products_variants table (Payload CMS array storage)
// matching the first line item sku. Falls back to NULL if no match found.
export async function getOrdersForReview(): Promise<OrderForReview[]> {
  return sql<OrderForReview[]>`
    SELECT
      o.id::text,
      o.customer_email,
      o.customer_name,
      s.status as subscriber_status,
      p.id as product_id,
      p.slug as product_slug
    FROM public.orders o
    LEFT JOIN marketing.subscribers s ON s.email = o.customer_email
    LEFT JOIN LATERAL (
      SELECT p2.id, p2.slug FROM public.products p2
      INNER JOIN public.products_variants pv ON pv._parent_id = p2.id
      WHERE pv.sku = (o.line_items->0->>'sku')
      LIMIT 1
    ) p ON true
    WHERE o.delivered_at <= NOW() - INTERVAL '7 days'
      AND o.review_email_sent_at IS NULL
      AND o.customer_email IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
  `
}

// Mark review email as sent on the order.
export async function markReviewEmailSent(orderId: string): Promise<void> {
  await sql`
    UPDATE public.orders
    SET review_email_sent_at = NOW()
    WHERE id = ${orderId}::integer
  `
}

// Active subscribers with no purchase in 90 days and no email in last 30 days.
export async function getInactiveSubscribers(limit = 100): Promise<Subscriber[]> {
  return sql<Subscriber[]>`
    SELECT s.*
    FROM marketing.subscribers s
    WHERE s.status = 'active'
      AND s.last_purchase_at IS NOT NULL
      AND s.last_purchase_at <= NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM marketing.email_log el
        WHERE el.subscriber_id = s.id
          AND el.sent_at >= NOW() - INTERVAL '30 days'
      )
    LIMIT ${limit}
  `
}

// Get subscriber by ID (for unsubscribe flow).
export async function getSubscriberById(id: string): Promise<Subscriber | null> {
  const rows = await sql<Subscriber[]>`
    SELECT * FROM marketing.subscribers WHERE id = ${id} LIMIT 1
  `
  return rows[0] ?? null
}

// Unsubscribe: set status = 'unsubscribed'.
export async function unsubscribeById(id: string): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET status = 'unsubscribed', unsubscribed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
  `
}

// Bounce: set status = 'bounced' by email.
export async function bounceByEmail(email: string): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET status = 'bounced', updated_at = NOW()
    WHERE email = ${email}
  `
}

// Upsert cliente nella collection Payload CMS customers.
// Crea se non esiste, incrementa total_orders se esiste già.
export async function upsertCmsCustomer(params: {
  email: string
  name: string | null
  country: string | null
}): Promise<void> {
  const { email, name, country } = params
  await sql`
    INSERT INTO public.customers (email, name, country, total_orders, updated_at, created_at)
    VALUES (${email}, ${name}, ${country}, 1, NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET
      name        = COALESCE(EXCLUDED.name, public.customers.name),
      country     = COALESCE(EXCLUDED.country, public.customers.country),
      total_orders = public.customers.total_orders + 1,
      updated_at  = NOW()
  `
}
