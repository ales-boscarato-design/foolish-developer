import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber, getWishlist } from '@/lib/account-db'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import Link from 'next/link'
import { ReorderButton } from './_components/ReorderButton'

export default async function AccountHome() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const [subscriber, wishlist, locale] = await Promise.all([
    getAccountSubscriber(session.email),
    getWishlist(session.email),
    getAccountLocale(),
  ])
  if (!subscriber) redirect('/account/login')

  const t = getT(locale)

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const ordersRes = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=10&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const ordersData = ordersRes.ok ? await ordersRes.json() : { docs: [] }
  const orders = ordersData.docs ?? []

  const activeOrder = orders.find((o: Record<string, unknown>) =>
    !['closed', 'delivered', 'followup_done'].includes(o.pipelineState as string)
  )
  const lastDelivered = orders.find((o: Record<string, unknown>) => o.pipelineState === 'delivered')

  const PIPELINE_PROGRESS: Record<string, number> = {
    received: 10, eta_pending: 15, eta_confirmed: 25, in_production: 45,
    matching_pending: 60, matched: 70, preview_sent: 80, shipped: 90,
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
          The Foolish Butcher
        </div>
        <div style={{ fontSize: '20px', fontWeight: 300 }}>
          {t('hello')}{subscriber.name ? `, ${subscriber.name.split(' ')[0]}` : ''}
        </div>
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
          {subscriber.level ?? t('customer')} · {subscriber.purchase_count} {t('orders_total')}
        </div>
      </div>

      {activeOrder && (
        <Link href={`/account/ordini/${activeOrder.orderNumber}`} style={{ textDecoration: 'none' }}>
          <div style={{ background: '#111', border: '1px solid #c9a96e44', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', color: '#c9a96e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
              {t('active_order')}
            </div>
            <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
              #{activeOrder.orderNumber}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <div style={{ width: '6px', height: '6px', background: '#c9a96e', borderRadius: '50%' }} />
              <div style={{ fontSize: '11px', color: '#c9a96e' }}>
                {activeOrder.pipelineState as string}
                {activeOrder.productionEtaDays ? ` · ETA ${activeOrder.productionEtaDays} ${t('eta_days')}` : ''}
              </div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: '2px', height: '3px', marginBottom: '4px' }}>
              <div style={{ background: '#c9a96e', height: '3px', borderRadius: '2px', width: `${PIPELINE_PROGRESS[activeOrder.pipelineState as string] ?? 50}%` }} />
            </div>
          </div>
        </Link>
      )}

      {lastDelivered && (
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            {t('last_received')}
          </div>
          <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
            #{lastDelivered.orderNumber}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
            {Array.isArray(lastDelivered.lineItems) ? (lastDelivered.lineItems as { name: string }[]).map(i => i.name).join(', ') : ''}
          </div>
          <ReorderButton orderId={lastDelivered.orderNumber as string} label={t('reorder')} />
        </div>
      )}

      {wishlist.length > 0 && (
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
            {t('saved')} ({wishlist.length})
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {wishlist.slice(0, 3).map((item) => (
              <div key={item.id} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', color: '#aaa' }}>
                {item.product_name}
              </div>
            ))}
            {wishlist.length > 3 && (
              <Link href="/account/file" style={{ background: '#1a1a1a', border: '1px solid #c9a96e44', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', color: '#c9a96e', textDecoration: 'none' }}>
                {t('view_all')}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
