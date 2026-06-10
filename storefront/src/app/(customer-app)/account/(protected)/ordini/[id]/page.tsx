import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import Link from 'next/link'
import { ReorderButton } from '../../_components/ReorderButton'

const PIPELINE_STEPS = ['received','in_production','shipped','delivered']

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect('/account/login')

  const locale = await getAccountLocale()
  const t = getT(locale)

  const STATE_LABELS: Record<string, string> = {
    received: t('received'), in_production: t('in_production'),
    shipped: t('shipped'), delivered: t('delivered'),
  }

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/orders?where[orderNumber][equals]=${id}&where[customerEmail][equals]=${encodeURIComponent(session.email)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const order = data.docs?.[0]
  if (!order) notFound()

  const currentStepIndex = PIPELINE_STEPS.findIndex((s) => s === order.pipelineState)
  const isDelivered = order.pipelineState === 'delivered' || order.pipelineState === 'followup_done' || order.pipelineState === 'closed'

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingTop: '8px' }}>
        <Link href="/account/ordini" style={{ color: '#555', fontSize: '20px', textDecoration: 'none' }}>←</Link>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase' }}>{t('order_label')} #{order.orderNumber}</div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ background: '#111', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < PIPELINE_STEPS.length - 1 ? 1 : undefined }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', margin: '0 auto 4px', background: isDelivered || i <= currentStepIndex ? '#5a7a5a' : '#333', boxShadow: i === currentStepIndex && !isDelivered ? '0 0 6px #c9a96e' : 'none' }} />
                <div style={{ fontSize: '8px', color: isDelivered || i <= currentStepIndex ? '#5a7a5a' : '#444', whiteSpace: 'nowrap' }}>{STATE_LABELS[step]}</div>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div style={{ flex: 1, height: '1px', background: isDelivered || i < currentStepIndex ? '#5a7a5a' : '#333', margin: '0 4px 12px' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {Array.isArray(order.sheetPhotos) && order.sheetPhotos.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>{t('your_sheets')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {(order.sheetPhotos as { url: string; caption?: string }[]).map((photo, i) => (
              <div key={i}>
                <img src={photo.url} alt={photo.caption ?? ''} style={{ width: '100%', borderRadius: '6px', aspectRatio: '1', objectFit: 'cover', border: '1px solid #222' }} />
                {photo.caption && <div style={{ fontSize: '10px', color: '#555', marginTop: '3px' }}>{photo.caption}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {order.trackingNumber && (
        <div style={{ background: '#111', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>{t('tracking')}</div>
          <div style={{ fontSize: '12px', color: '#aaa', fontFamily: 'monospace' }}>
            {order.trackingCarrier} · {order.trackingNumber}
          </div>
        </div>
      )}

      {isDelivered && <ReorderButton orderId={order.orderNumber} label={t('reorder')} />}
    </div>
  )
}
