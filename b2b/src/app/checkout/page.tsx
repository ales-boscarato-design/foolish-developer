'use client'
import { useState, useEffect } from 'react'
import { useCart } from '@/lib/cart'
import { formatPrice } from '@/lib/pricing'
import { useRouter } from 'next/navigation'

interface FormData {
  businessName: string
  vatNumber: string
  sdiCode: string
  billingAddress1: string
  billingCity: string
  billingPostalCode: string
  billingCountry: string
  shippingName: string
  shippingAddress1: string
  shippingCity: string
  shippingPostalCode: string
  shippingCountry: string
  paymentMethod: 'bonifico' | 'stripe'
  notes: string
}

export default function CheckoutPage() {
  const { items, total, clear } = useCart()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormData>({
    businessName: '', vatNumber: '', sdiCode: '', billingAddress1: '', billingCity: '',
    billingPostalCode: '', billingCountry: 'IT', shippingName: '', shippingAddress1: '',
    shippingCity: '', shippingPostalCode: '', shippingCountry: 'IT',
    paymentMethod: 'bonifico', notes: '',
  })

  // Pre-fill from session
  useEffect(() => {
    fetch('/api/account/orders')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.session) {
          setForm(f => ({
            ...f,
            businessName: data.session.businessName ?? '',
            vatNumber: data.session.vatNumber ?? '',
            shippingName: data.session.businessName ?? '',
          }))
        }
      })
      .catch(() => { /* pre-fill is best-effort; form remains blank */ })
  }, [])

  useEffect(() => {
    if (items.length === 0) router.replace('/carrello')
  }, [items.length, router])

  const cartTotal = total()
  const stripeTotal = cartTotal * 1.04
  const displayTotal = form.paymentMethod === 'stripe' ? stripeTotal : cartTotal

  function set(field: keyof FormData, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (form.paymentMethod === 'stripe') {
        const res = await fetch('/api/stripe/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, items, total: stripeTotal }),
        })
        const { clientSecret, orderNumber } = await res.json()
        sessionStorage.setItem('stripe_order', JSON.stringify({ clientSecret, orderNumber, form }))
        router.push('/checkout/stripe-pay')
        return
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items, total: cartTotal }),
      })

      if (res.ok) {
        const { orderNumber } = await res.json()
        clear()
        router.push(`/checkout/conferma?ordine=${orderNumber}&metodo=bonifico`)
      } else {
        alert('Errore durante la creazione dell\'ordine. Riprova.')
      }
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: '0.5rem',
    padding: '0.6rem 0.875rem',
    fontSize: '0.875rem',
    width: '100%',
    background: 'var(--surface-2)',
    color: 'var(--foreground)',
    outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.65rem',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    color: 'var(--muted-fg)',
    marginBottom: '0.4rem',
  }

  const sectionHeadStyle: React.CSSProperties = {
    fontFamily: 'var(--font-cormorant)',
    fontStyle: 'italic',
    fontWeight: 600,
    fontSize: '1.25rem',
    color: 'var(--foreground)',
    marginBottom: '1.25rem',
    paddingBottom: '0.75rem',
    borderBottom: '1px solid var(--border)',
  }

  const radioCardBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.875rem',
    border: '1px solid var(--border)',
    borderRadius: '0.75rem',
    padding: '1rem',
    cursor: 'pointer',
    transition: 'border-color var(--dur-fast), background var(--dur-fast)',
  }

  return (
    <div style={{ maxWidth: '42rem' }}>
      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', marginBottom: '2rem', color: 'var(--foreground)' }}>
        Checkout
      </h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>

        {/* FATTURAZIONE */}
        <section>
          <h2 style={sectionHeadStyle}>Dati fatturazione</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Ragione sociale *</label>
              <input required style={inputStyle} value={form.businessName}
                onChange={e => set('businessName', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>P.IVA *</label>
              <input required style={inputStyle} value={form.vatNumber}
                onChange={e => set('vatNumber', e.target.value)} placeholder="IT12345678901" />
            </div>
            <div>
              <label style={labelStyle}>Codice SDI / PEC *</label>
              <input required style={inputStyle} value={form.sdiCode}
                onChange={e => set('sdiCode', e.target.value)} placeholder="0000000 o pec@email.it" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Indirizzo di fatturazione *</label>
              <input required style={inputStyle} value={form.billingAddress1}
                onChange={e => set('billingAddress1', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Città *</label>
              <input required style={inputStyle} value={form.billingCity}
                onChange={e => set('billingCity', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>CAP *</label>
              <input required style={inputStyle} value={form.billingPostalCode}
                onChange={e => set('billingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* SPEDIZIONE */}
        <section>
          <h2 style={sectionHeadStyle}>Indirizzo di spedizione</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Nome / Ragione sociale destinatario *</label>
              <input required style={inputStyle} value={form.shippingName}
                onChange={e => set('shippingName', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Indirizzo *</label>
              <input required style={inputStyle} value={form.shippingAddress1}
                onChange={e => set('shippingAddress1', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Città *</label>
              <input required style={inputStyle} value={form.shippingCity}
                onChange={e => set('shippingCity', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>CAP *</label>
              <input required style={inputStyle} value={form.shippingPostalCode}
                onChange={e => set('shippingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* PAGAMENTO */}
        <section>
          <h2 style={sectionHeadStyle}>Metodo di pagamento</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{
              ...radioCardBase,
              borderColor: form.paymentMethod === 'bonifico' ? 'rgba(200,169,126,0.4)' : 'var(--border)',
              background: form.paymentMethod === 'bonifico' ? 'rgba(200,169,126,0.05)' : 'transparent',
            }}>
              <input type="radio" name="payment" value="bonifico"
                checked={form.paymentMethod === 'bonifico'}
                onChange={() => set('paymentMethod', 'bonifico')}
                style={{ marginTop: '0.15rem', accentColor: 'var(--accent)' }} />
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: '0.25rem' }}>Bonifico bancario</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>Riceverai le coordinate al momento della conferma</p>
              </div>
            </label>
            <label style={{
              ...radioCardBase,
              borderColor: form.paymentMethod === 'stripe' ? 'rgba(200,169,126,0.4)' : 'var(--border)',
              background: form.paymentMethod === 'stripe' ? 'rgba(200,169,126,0.05)' : 'transparent',
            }}>
              <input type="radio" name="payment" value="stripe"
                checked={form.paymentMethod === 'stripe'}
                onChange={() => set('paymentMethod', 'stripe')}
                style={{ marginTop: '0.15rem', accentColor: 'var(--accent)' }} />
              <div>
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: '0.25rem' }}>Carta di credito (Stripe)</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                  Supplemento del 4% per pagamento con carta.
                  Totale con carta: {formatPrice(stripeTotal)}
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* NOTE */}
        <div>
          <label style={labelStyle}>Note (opzionale)</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical' }}
            rows={3}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Note per l'ordine, istruzioni di consegna, ecc."
          />
        </div>

        {/* RIEPILOGO + SUBMIT */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)', marginBottom: '0.5rem' }}>
            <span>Subtotale prodotti</span>
            <span style={{ color: 'var(--foreground)' }}>{formatPrice(cartTotal)}</span>
          </div>
          {form.paymentMethod === 'stripe' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)', marginBottom: '0.5rem' }}>
              <span>Supplemento carta (4%)</span>
              <span>+{formatPrice(stripeTotal - cartTotal)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)', marginBottom: '1rem' }}>
            <span>Spedizione</span>
            <span>Da definire</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--muted-fg)' }}>Totale</span>
            <span style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.5rem', color: 'var(--foreground)' }}>
              {formatPrice(displayTotal)}
            </span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? 'rgba(200,169,126,0.3)' : 'var(--accent)',
            color: '#080808',
            border: 'none',
            borderRadius: '0.625rem',
            padding: '0.875rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            width: '100%',
            letterSpacing: '0.04em',
            transition: 'background var(--dur-fast)',
          }}
        >
          {loading ? 'Elaborazione...' : form.paymentMethod === 'bonifico'
            ? 'Conferma ordine (bonifico bancario)'
            : 'Paga con carta →'}
        </button>
      </form>
    </div>
  )
}
