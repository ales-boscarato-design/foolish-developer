import sql from './db'

export interface AccountSubscriber {
  email: string
  name: string | null
  locale: string
  level: string | null
  styles: string[]
  notify_orders: boolean
  notify_new_batches: boolean
  notify_offers: boolean
  push_subscription: unknown | null
  total_spent: number
  purchase_count: number
}

export interface WishlistItem {
  id: string
  product_slug: string
  product_name: string
  product_price: number | null
  saved_at: Date
  notified_at: Date | null
}

export async function getAccountSubscriber(email: string): Promise<AccountSubscriber | null> {
  const rows = await sql<AccountSubscriber[]>`
    SELECT email, name, locale, level, styles,
           notify_orders, notify_new_batches, notify_offers,
           push_subscription, total_spent, purchase_count
    FROM marketing.subscribers
    WHERE email = ${email} AND status = 'active'
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function updateSubscriberProfile(
  email: string,
  data: {
    level?: string | null
    styles?: string[]
    locale?: string
    notify_orders?: boolean
    notify_new_batches?: boolean
    notify_offers?: boolean
  }
): Promise<void> {
  if (Object.keys(data).length === 0) return

  // Build individual updates to avoid sql.unsafe parameter binding issues
  if (data.level !== undefined) await sql`UPDATE marketing.subscribers SET level = ${data.level ?? null}, updated_at = NOW() WHERE email = ${email}`
  if (data.styles !== undefined) await sql`UPDATE marketing.subscribers SET styles = ${sql.array(data.styles)}::text[], updated_at = NOW() WHERE email = ${email}`
  if (data.locale !== undefined) await sql`UPDATE marketing.subscribers SET locale = ${data.locale}, updated_at = NOW() WHERE email = ${email}`
  if (data.notify_orders !== undefined) await sql`UPDATE marketing.subscribers SET notify_orders = ${data.notify_orders}, updated_at = NOW() WHERE email = ${email}`
  if (data.notify_new_batches !== undefined) await sql`UPDATE marketing.subscribers SET notify_new_batches = ${data.notify_new_batches}, updated_at = NOW() WHERE email = ${email}`
  if (data.notify_offers !== undefined) await sql`UPDATE marketing.subscribers SET notify_offers = ${data.notify_offers}, updated_at = NOW() WHERE email = ${email}`
}

export async function savePushSubscription(email: string, subscription: unknown): Promise<{ isFirstTime: boolean }> {
  const rows = await sql<{ had_sub: boolean }[]>`
    SELECT push_subscription IS NOT NULL AS had_sub
    FROM marketing.subscribers WHERE email = ${email}
  `
  const isFirstTime = !rows[0]?.had_sub

  await sql`
    UPDATE marketing.subscribers
    SET
      push_subscription = ${JSON.stringify(subscription)}::jsonb,
      push_subscribed_at = COALESCE(push_subscribed_at, NOW()),
      updated_at = NOW()
    WHERE email = ${email}
  `
  return { isFirstTime }
}

export async function markPushSequenceStep(email: string, stepKey: string): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET push_sequence_state = COALESCE(push_sequence_state, '{}'::jsonb) || ${JSON.stringify({ [stepKey]: true })}::jsonb,
        updated_at = NOW()
    WHERE email = ${email}
  `
}

export async function getSubscribersForSequence(triggerHoursAgo: number): Promise<Array<{
  email: string; name: string | null; locale: string;
  push_subscribed_at: Date; push_sequence_state: Record<string, boolean>
}>> {
  return sql`
    SELECT email, name, locale, push_subscribed_at,
           COALESCE(push_sequence_state, '{}'::jsonb) AS push_sequence_state
    FROM marketing.subscribers
    WHERE push_subscription IS NOT NULL
      AND push_subscribed_at IS NOT NULL
      AND status = 'active'
  `
}

export async function getWishlist(email: string): Promise<WishlistItem[]> {
  return sql<WishlistItem[]>`
    SELECT id, product_slug, product_name, product_price, saved_at, notified_at
    FROM account.wishlist
    WHERE subscriber_email = ${email}
    ORDER BY saved_at DESC
  `
}

export async function addToWishlist(
  email: string,
  item: { product_slug: string; product_name: string; product_price?: number }
): Promise<void> {
  await sql`
    INSERT INTO account.wishlist (subscriber_email, product_slug, product_name, product_price)
    VALUES (${email}, ${item.product_slug}, ${item.product_name}, ${item.product_price ?? null})
    ON CONFLICT (subscriber_email, product_slug) DO NOTHING
  `
}

export async function removeFromWishlist(email: string, productSlug: string): Promise<void> {
  await sql`
    DELETE FROM account.wishlist
    WHERE subscriber_email = ${email} AND product_slug = ${productSlug}
  `
}

// ─── Customer Offers ────────────────────────────────────────────────────────

export interface CustomerOffer {
  id: number
  email: string
  order_number: string
  product_slug: string
  discount_percent: number
  promo_code: string
  expires_at: Date
  used: boolean
}

// Table is created via migration — no runtime CREATE TABLE needed
async function ensureOffersTable() { /* noop — table exists */ }

export async function createCustomerOffer(
  email: string,
  orderNumber: string,
  productSlug: string,
  discountPercent: number,
  validityHours: number
): Promise<string> {
  await ensureOffersTable()
  // Generate unique code: OFFER-{6 random chars}-{discount}
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase()
  const code = `OFFER-${rand}-${discountPercent}`
  const expiresAt = new Date(Date.now() + validityHours * 60 * 60 * 1000)
  await sql`
    INSERT INTO account.customer_offers (email, order_number, product_slug, discount_percent, promo_code, expires_at)
    VALUES (${email}, ${orderNumber}, ${productSlug}, ${discountPercent}, ${code}, ${expiresAt})
    ON CONFLICT DO NOTHING
  `
  return code
}

export async function getActiveCustomerOffer(email: string): Promise<CustomerOffer | null> {
  await ensureOffersTable()
  const rows = await sql<CustomerOffer[]>`
    SELECT * FROM account.customer_offers
    WHERE email = ${email}
      AND used = false
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function getOfferByCode(code: string): Promise<CustomerOffer | null> {
  await ensureOffersTable()
  const rows = await sql<CustomerOffer[]>`
    SELECT * FROM account.customer_offers
    WHERE promo_code = ${code}
      AND used = false
      AND expires_at > NOW()
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function markOfferUsed(code: string): Promise<void> {
  await sql`UPDATE account.customer_offers SET used = true WHERE promo_code = ${code}`
}
