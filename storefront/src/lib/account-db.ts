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
  if (data.styles !== undefined) await sql`UPDATE marketing.subscribers SET styles = ${data.styles as string[]}, updated_at = NOW() WHERE email = ${email}`
  if (data.locale !== undefined) await sql`UPDATE marketing.subscribers SET locale = ${data.locale}, updated_at = NOW() WHERE email = ${email}`
  if (data.notify_orders !== undefined) await sql`UPDATE marketing.subscribers SET notify_orders = ${data.notify_orders}, updated_at = NOW() WHERE email = ${email}`
  if (data.notify_new_batches !== undefined) await sql`UPDATE marketing.subscribers SET notify_new_batches = ${data.notify_new_batches}, updated_at = NOW() WHERE email = ${email}`
  if (data.notify_offers !== undefined) await sql`UPDATE marketing.subscribers SET notify_offers = ${data.notify_offers}, updated_at = NOW() WHERE email = ${email}`
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
