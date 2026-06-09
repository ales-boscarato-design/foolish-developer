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
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.level !== undefined) { updates.push(`level = $${i++}`); values.push(data.level) }
  if (data.styles !== undefined) { updates.push(`styles = $${i++}`); values.push(data.styles) }
  if (data.locale !== undefined) { updates.push(`locale = $${i++}`); values.push(data.locale) }
  if (data.notify_orders !== undefined) { updates.push(`notify_orders = $${i++}`); values.push(data.notify_orders) }
  if (data.notify_new_batches !== undefined) { updates.push(`notify_new_batches = $${i++}`); values.push(data.notify_new_batches) }
  if (data.notify_offers !== undefined) { updates.push(`notify_offers = $${i++}`); values.push(data.notify_offers) }

  if (updates.length === 0) return

  values.push(email)
  await sql`
    UPDATE marketing.subscribers
    SET ${sql.unsafe(updates.join(', '))}, updated_at = NOW()
    WHERE email = ${email}
  `
}

export async function savePushSubscription(email: string, subscription: unknown): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET push_subscription = ${JSON.stringify(subscription)}::jsonb, updated_at = NOW()
    WHERE email = ${email}
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
