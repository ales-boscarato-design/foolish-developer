'use client'
import { useState } from 'react'
import type { PlanKey, Zone } from '@/lib/subscription-plans'
import { parseSubscriptionCheckoutResponse } from '@/lib/subscription-checkout-response'

export function SubscribeCTA({ plan, locale, ctaLabel, loadingLabel, errorLabel, zonePickerLabel, tabIt, tabEu }: {
  plan: PlanKey
  locale: string
  ctaLabel: string
  loadingLabel: string
  errorLabel: string
  zonePickerLabel: string
  tabIt: string
  tabEu: string
}) {
  const [zone, setZone] = useState<Zone>('IT')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubscribe() {
    if (!email) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/subscribe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, zone, email, locale }),
      })
      // Un proxy o un errore di rete possono restituire HTML: si legge il
      // corpo una volta sola e si tollera il JSON malformato.
      const raw = await res.text()
      let body: unknown = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = null }
      const result = parseSubscriptionCheckoutResponse(res.status, body)
      if ('error' in result) setError(errorLabel)
      else window.location.href = result.checkoutUrl
    } catch {
      setError(errorLabel)
    } finally {
      setLoading(false)
    }
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
      {error !== null && (
        <p role="alert" aria-live="polite" style={{ marginTop: '10px', fontSize: '13px', color: '#c0392b' }}>{error}</p>
      )}
    </div>
  )
}
