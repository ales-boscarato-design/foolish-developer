import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountLocale, getT } from '@/lib/account-i18n'

interface SheetPhoto { url: string; caption?: string }
interface OrderDoc { orderNumber: string; sheetPhotos?: SheetPhoto[]; lineItems?: { variantLabel?: string }[]; pipelineState: string }

function extractFormat(lineItems?: { variantLabel?: string }[], fallback = 'Other'): string {
  const label = lineItems?.[0]?.variantLabel ?? ''
  if (label.includes('A4')) return 'A4'
  if (label.includes('A5')) return 'A5'
  if (label.includes('XXL')) return 'XXL'
  return fallback
}

export default async function Collezionepage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const locale = await getAccountLocale()
  const t = getT(locale)

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=50&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const orders: OrderDoc[] = data.docs ?? []

  const ACTIVE_STATES = ['received','eta_pending','eta_confirmed','in_production','matching_pending','matched','preview_sent','shipped']

  const allSheets = orders.flatMap((order) => {
    if (!order.sheetPhotos?.length) return []
    return order.sheetPhotos.map((photo) => ({
      ...photo,
      format: extractFormat(order.lineItems, t('other_format')),
      orderNumber: order.orderNumber,
      isActive: ACTIVE_STATES.includes(order.pipelineState),
    }))
  })

  const totalInArrivo = orders
    .filter((o) => ACTIVE_STATES.includes(o.pipelineState))
    .reduce((sum, o) => sum + (o.lineItems?.length ?? 0), 0)

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>{t('your_collection')}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: '18px', fontWeight: 300 }}>{allSheets.length} {t('sheets_received')}</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{orders.length} {t('orders_total')}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
        {allSheets.map((sheet, i) => (
          <div key={i} style={{ background: '#1a1a1a', borderRadius: '6px', overflow: 'hidden', border: '1px solid #222' }}>
            <img src={sheet.url} alt={sheet.caption ?? ''} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }} />
            <div style={{ padding: '5px 6px' }}>
              <div style={{ fontSize: '9px', color: '#c9a96e' }}>{sheet.format}</div>
              {sheet.caption && <div style={{ fontSize: '9px', color: '#555', marginTop: '1px' }}>{sheet.caption}</div>}
            </div>
          </div>
        ))}

        {totalInArrivo > 0 && (
          <div style={{ background: '#1a1a1a', borderRadius: '6px', border: '1px dashed #333' }}>
            <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#333' }}>
              +{totalInArrivo}
            </div>
            <div style={{ padding: '5px 6px' }}>
              <div style={{ fontSize: '9px', color: '#444' }}>{t('incoming')}</div>
            </div>
          </div>
        )}
      </div>

      {allSheets.length === 0 && (
        <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>
          {t('sheets_appear')}
        </div>
      )}
    </div>
  )
}
