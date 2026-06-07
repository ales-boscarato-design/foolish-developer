import { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { Package, MapPin, Truck, ArrowLeft } from 'lucide-react'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
}

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://admin.thefoolishbutcher.com'
const CMS_SECRET = process.env.PAYLOAD_API_SECRET || ''

const PIPELINE_STATE_LABELS: Record<string, string> = {
  received: 'statusReceived',
  eta_pending: 'statusEtaPending',
  eta_confirmed: 'statusEtaConfirmed',
  in_production: 'statusInProduction',
  matching_pending: 'statusMatchingPending',
  matched: 'statusMatched',
  preview_sent: 'statusPreviewSent',
  shipped: 'statusShipped',
  delivered: 'statusDelivered',
  followup_done: 'statusFollowupDone',
  closed: 'statusClosed',
}

async function getOrder(orderNumber: string) {
  const res = await fetch(
    `${CMS_URL}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderNumber)}&depth=1`,
    {
      headers: { 'x-storefront-secret': CMS_SECRET },
      next: { revalidate: 0 },
    },
  )
  if (!res.ok) return null
  const data = await res.json()
  return data.docs?.[0] ?? null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'ordine' })
  return {
    title: t('meta'),
  }
}

export default async function OrdinePage({ params }: PageProps) {
  const { id: orderNumber, locale } = await params
  const t = await getTranslations({ locale, namespace: 'ordine' })
  const tAccount = await getTranslations({ locale, namespace: 'account' })

  const order = await getOrder(orderNumber)

  if (!order) {
    return (
      <div className="max-w-xl mx-auto px-4 py-24 text-center">
        <Package size={40} className="mx-auto mb-4 opacity-30" />
        <p className="text-lg font-medium mb-2">{tAccount('noOrders')}</p>
        <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>
          {tAccount('errorNotFound')}
        </p>
        <Link
          href="/account"
          className="text-sm underline"
          style={{ color: 'var(--accent)' }}
        >
          {t('backToAccount')}
        </Link>
      </div>
    )
  }

  const stateKey = PIPELINE_STATE_LABELS[order.pipelineState ?? 'received'] ?? 'statusReceived'
  const items = Array.isArray(order.lineItems) ? order.lineItems : []

  return (
    <div className="max-w-2xl mx-auto px-4 py-12">
      <Link
        href="/account"
        className="inline-flex items-center gap-1.5 text-sm mb-8 hover:underline"
        style={{ color: 'var(--muted-fg)' }}
      >
        <ArrowLeft size={14} />
        {t('backToAccount')}
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <Package size={20} style={{ color: 'var(--accent)' }} />
        <h1 className="text-2xl font-bold">{t('title')} {order.orderNumber}</h1>
      </div>

      <div className="space-y-6">

        <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--muted-fg)' }}>{t('status')}</h2>
          <span
            className="inline-block px-3 py-1.5 rounded-full text-sm font-medium"
            style={{ backgroundColor: 'var(--accent)', color: 'black' }}
          >
            {t(stateKey)}
          </span>
          {order.productionEtaDays && (
            <p className="text-sm mt-2" style={{ color: 'var(--muted-fg)' }}>
              {t('productionEta')}: {t('days', { days: order.productionEtaDays })}
            </p>
          )}
        </div>

        {items.length > 0 && (
          <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--muted-fg)' }}>{t('items')}</h2>
            <div className="space-y-3">
              {items.map((item: { productName?: string; sku?: string; variantLabel?: string; quantity?: number; price?: number }, i: number) => (
                <div key={i} className="flex justify-between text-sm">
                  <div>
                    <span className="font-medium">{item.productName ?? item.sku ?? 'Prodotto'}</span>
                    {item.variantLabel && (
                      <span className="block text-xs" style={{ color: 'var(--muted-fg)' }}>
                        {item.variantLabel}
                      </span>
                    )}
                    {item.quantity && (
                      <span className="block text-xs" style={{ color: 'var(--muted-fg)' }}>
                        × {item.quantity}
                      </span>
                    )}
                  </div>
                  <span className="font-medium">
                    {item.price != null ? `${(item.price * (item.quantity ?? 1)).toFixed(2)}€` : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--muted-fg)' }}>{t('orderTotal')}</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted-fg)' }}>{t('shipping')}</span>
              <span>{order.shippingCost ? `${order.shippingCost.toFixed(2)}€` : t('itemsIncluded')}</span>
            </div>
            <div className="flex justify-between font-bold text-base pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <span>{t('orderTotal')}</span>
              <span style={{ color: 'var(--accent)' }}>{order.total.toFixed(2)}€</span>
            </div>
          </div>
        </div>

        {order.shippingAddress && (
          <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={14} style={{ color: 'var(--muted-fg)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--muted-fg)' }}>{t('shippingAddress')}</h2>
            </div>
            <div className="text-sm space-y-1">
              <p className="font-medium">{order.shippingAddress.name}</p>
              <p style={{ color: 'var(--muted-fg)' }}>{order.shippingAddress.address1}</p>
              {order.shippingAddress.address2 && (
                <p style={{ color: 'var(--muted-fg)' }}>{order.shippingAddress.address2}</p>
              )}
              <p style={{ color: 'var(--muted-fg)' }}>
                {order.shippingAddress.postalCode} {order.shippingAddress.city}
              </p>
              <p style={{ color: 'var(--muted-fg)' }}>{order.shippingAddress.country}</p>
            </div>
          </div>
        )}

        {(order.trackingNumber || order.trackingCarrier) && (
          <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Truck size={14} style={{ color: 'var(--muted-fg)' }} />
              <h2 className="text-sm font-semibold" style={{ color: 'var(--muted-fg)' }}>{t('tracking')}</h2>
            </div>
            <div className="space-y-2 text-sm">
              {order.trackingCarrier && (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--muted-fg)' }}>{t('carrier')}</span>
                  <span>{order.trackingCarrier}</span>
                </div>
              )}
              {order.trackingNumber ? (
                <div className="flex justify-between">
                  <span style={{ color: 'var(--muted-fg)' }}>{t('tracking')}</span>
                  <span className="font-mono text-xs">{order.trackingNumber}</span>
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--muted-fg)' }}>{t('trackingPlaceholder')}</p>
              )}
            </div>
          </div>
        )}

        <div className="rounded-lg p-5 border text-left" style={{ borderColor: '#0088cc33', backgroundColor: '#f0f8ff' }}>
          <p className="font-medium mb-1 text-sm">{t('telegramTitle')}</p>
          <p className="text-xs mb-3" style={{ color: 'var(--muted-fg)' }}>{t('telegramBody')}</p>
          <a
            href={`https://t.me/the_foolish_butcher_bot?start=order_${order.orderNumber}`}
            target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded font-semibold text-xs"
            style={{ backgroundColor: '#229ED9', color: 'white' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.614c-.146.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.903.607z"/>
            </svg>
            {t('telegramCta')}
          </a>
        </div>

      </div>
    </div>
  )
}
