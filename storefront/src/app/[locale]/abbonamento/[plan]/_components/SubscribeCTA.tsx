'use client'
import { useState } from 'react'
import type { PlanKey, Zone } from '@/lib/subscription-plans'

export function SubscribeCTA({ plan, locale, ctaLabel, loadingLabel, zonePickerLabel, tabIt, tabEu }: {
  plan: PlanKey
  locale: string
  ctaLabel: string
  loadingLabel: string
  zonePickerLabel: string
  tabIt: string
  tabEu: string
}) {
  const [zone, setZone] = useState<Zone>('IT')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubscribe() {
    if (!email) return
    setLoading(true)
    const res = await fetch('/api/subscribe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, zone, email, locale }),
    })
    const data = await res.json()
    setLoading(false)
    if (data.checkoutUrl) window.location.href = data.checkoutUrl
  }

  return (
    <div style={{ marginTop: '24px' }}>
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--muted-fg)' }}>{zonePickerLabel}</p>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['IT', 'EU'] as const).map((z) => (
          <button
            key={z}
            onClick={() => setZone(z)}
            style={{
              fontSize: '11px', textTransform: 'uppercase', padding: '7px 16px', borderRadius: '20px',
              border: `1px solid ${zone === z ? 'var(--accent)' : 'var(--border)'}`,
              color: zone === z ? 'var(--accent)' : 'var(--muted-fg)', background: 'transparent', cursor: 'pointer',
            }}
          >
            {z === 'IT' ? tabIt : tabEu}
          </button>
        ))}
      </div>
      <input
        type="email"
        placeholder="email@esempio.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          width: '100%', maxWidth: '320px', padding: '10px 14px', marginBottom: '12px',
          background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--foreground)',
        }}
      />
      <button
        onClick={handleSubscribe}
        disabled={loading || !email}
        className="ghost-cta"
        style={{
          display: 'block', padding: '12px 28px', border: '1px solid var(--accent)', color: 'var(--accent)',
          background: 'transparent', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.08em',
          cursor: loading ? 'default' : 'pointer', opacity: !email ? 0.5 : 1,
        }}
      >
        {loading ? loadingLabel : ctaLabel}
      </button>
    </div>
  )
}
