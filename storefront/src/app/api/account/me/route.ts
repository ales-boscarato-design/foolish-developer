import { NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber, getWishlist } from '@/lib/account-db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [subscriber, wishlist] = await Promise.all([
    getAccountSubscriber(session.email),
    getWishlist(session.email),
  ])

  if (!subscriber) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch orders from CMS
  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const ordersRes = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=50&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, next: { revalidate: 0 } }
  )
  const ordersData = ordersRes.ok ? await ordersRes.json() : { docs: [] }
  // Affiliate commission snapshots are internal: the customer sees the order,
  // not what the shop pays an affiliate on it.
  const orders = (ordersData.docs ?? []).map((order: Record<string, unknown>) => {
    const customerVisibleOrder = { ...order }
    for (const field of [
      'affiliatePromoCode',
      'affiliateSlug',
      'affiliateEligibleAmountCents',
      'affiliateCommissionRateBps',
      'affiliateCommissionCents',
    ]) {
      delete customerVisibleOrder[field]
    }
    return customerVisibleOrder
  })

  return NextResponse.json({
    subscriber,
    orders,
    wishlist,
  })
}
