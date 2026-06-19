'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/pricing'
import { useTranslations, useLocale } from 'next-intl'

interface Order {
  id: number
  order_number: string
  total: number
  pipeline_state: string
  created_at: string
  tracking_number: string | null
}

interface SessionData {
  businessName: string
  contactName: string
  email: string
  vatNumber: string
}

export default function AccountPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const t = useTranslations('Account')
  const locale = useLocale()

  const stateLabels: Record<string, string> = {
    received: t('states.received'),
    in_production: t('states.in_production'),
    shipped: t('states.shipped'),
    delivered: t('states.delivered'),
  }

  useEffect(() => {
    fetch('/api/account/orders')
      .then(r => {
        if (r.status === 401) { router.replace('/login'); return null }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data) {
          setSession(data.session)
          setOrders(data.orders)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  if (loading) return <p style={{ color: 'var(--muted-fg)', fontSize: '0.85rem' }}>{t('caricamento')}</p>

  return (
    <div style={{ maxWidth: '48rem' }}>
      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', marginBottom: '2.5rem' }}>
        {t('titolo')}
      </h1>

      {/* Profile */}
      {session && (
        <section style={{ marginBottom: '2.5rem' }}>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
            {t('profiloAziendale')}
          </p>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '1.5rem' }}>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1.5rem', fontSize: '0.85rem' }}>
              <dt style={{ color: 'var(--muted-fg)' }}>{t('ragioneSociale')}</dt>
              <dd style={{ margin: 0 }}>{session.businessName}</dd>
              <dt style={{ color: 'var(--muted-fg)' }}>{t('referente')}</dt>
              <dd style={{ margin: 0 }}>{session.contactName}</dd>
              <dt style={{ color: 'var(--muted-fg)' }}>{t('email')}</dt>
              <dd style={{ margin: 0 }}>{session.email}</dd>
              <dt style={{ color: 'var(--muted-fg)' }}>{t('piva')}</dt>
              <dd style={{ margin: 0 }}>{session.vatNumber}</dd>
            </dl>
          </div>
        </section>
      )}

      {/* Orders */}
      <section>
        <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
          {t('storicoOrdini')}
        </p>
        {orders.length === 0 ? (
          <p style={{ color: 'var(--muted-fg)', fontSize: '0.85rem' }}>{t('nessunoOrdine')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {orders.map(order => (
              <div key={order.id} style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '1rem 1.25rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 500 }}>{order.order_number}</span>
                  <span style={{ background: 'rgba(200,169,126,0.1)', color: 'var(--accent)', fontSize: '0.7rem', padding: '0.2rem 0.6rem', borderRadius: '0.375rem' }}>
                    {stateLabels[order.pipeline_state] ?? order.pipeline_state}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'var(--muted-fg)' }}>
                  <span>{new Date(order.created_at).toLocaleDateString(locale)}</span>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{formatPrice(order.total)}</span>
                </div>
                {order.tracking_number && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
                    {t('tracking') + ' '}<span style={{ fontFamily: 'monospace', color: 'var(--muted-fg)' }}>{order.tracking_number}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
