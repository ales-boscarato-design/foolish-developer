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

  const inputClass = "border border-stone-300 rounded px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-stone-400"
  const labelClass = "block text-xs text-stone-500 mb-1"

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Checkout</h1>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* FATTURAZIONE */}
        <section>
          <h2 className="font-medium mb-4 pb-2 border-b border-stone-100">Dati fatturazione</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Ragione sociale *</label>
              <input required className={inputClass} value={form.businessName}
                onChange={e => set('businessName', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>P.IVA *</label>
              <input required className={inputClass} value={form.vatNumber}
                onChange={e => set('vatNumber', e.target.value)} placeholder="IT12345678901" />
            </div>
            <div>
              <label className={labelClass}>Codice SDI / PEC *</label>
              <input required className={inputClass} value={form.sdiCode}
                onChange={e => set('sdiCode', e.target.value)} placeholder="0000000 o pec@email.it" />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Indirizzo di fatturazione *</label>
              <input required className={inputClass} value={form.billingAddress1}
                onChange={e => set('billingAddress1', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Città *</label>
              <input required className={inputClass} value={form.billingCity}
                onChange={e => set('billingCity', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>CAP *</label>
              <input required className={inputClass} value={form.billingPostalCode}
                onChange={e => set('billingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* SPEDIZIONE */}
        <section>
          <h2 className="font-medium mb-4 pb-2 border-b border-stone-100">Indirizzo di spedizione</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Nome / Ragione sociale destinatario *</label>
              <input required className={inputClass} value={form.shippingName}
                onChange={e => set('shippingName', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Indirizzo *</label>
              <input required className={inputClass} value={form.shippingAddress1}
                onChange={e => set('shippingAddress1', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Città *</label>
              <input required className={inputClass} value={form.shippingCity}
                onChange={e => set('shippingCity', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>CAP *</label>
              <input required className={inputClass} value={form.shippingPostalCode}
                onChange={e => set('shippingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* PAGAMENTO */}
        <section>
          <h2 className="font-medium mb-4 pb-2 border-b border-stone-100">Metodo di pagamento</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3 border border-stone-200 rounded p-3 cursor-pointer hover:border-stone-400">
              <input type="radio" name="payment" value="bonifico"
                checked={form.paymentMethod === 'bonifico'}
                onChange={() => set('paymentMethod', 'bonifico')} />
              <div>
                <p className="text-sm font-medium">Bonifico bancario</p>
                <p className="text-xs text-stone-400">Riceverai le coordinate al momento della conferma</p>
              </div>
            </label>
            <label className="flex items-center gap-3 border border-stone-200 rounded p-3 cursor-pointer hover:border-stone-400">
              <input type="radio" name="payment" value="stripe"
                checked={form.paymentMethod === 'stripe'}
                onChange={() => set('paymentMethod', 'stripe')} />
              <div>
                <p className="text-sm font-medium">Carta di credito (Stripe)</p>
                <p className="text-xs text-stone-400">
                  Supplemento del 4% per pagamento con carta.
                  Totale con carta: {formatPrice(stripeTotal)}
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* NOTE */}
        <div>
          <label className={labelClass}>Note (opzionale)</label>
          <textarea className={inputClass} rows={3} value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Note per l'ordine, istruzioni di consegna, ecc." />
        </div>

        {/* RIEPILOGO + SUBMIT */}
        <div className="bg-stone-50 rounded-lg p-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Subtotale prodotti</span>
            <span>{formatPrice(cartTotal)}</span>
          </div>
          {form.paymentMethod === 'stripe' && (
            <div className="flex justify-between text-sm text-stone-500 mb-1">
              <span>Supplemento carta (4%)</span>
              <span>+{formatPrice(stripeTotal - cartTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-stone-400 mb-3">
            <span>Spedizione</span>
            <span>Da definire</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-stone-200 pt-3">
            <span>Totale</span>
            <span>{formatPrice(displayTotal)}</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-stone-900 text-white py-3 rounded text-sm hover:bg-stone-700 disabled:opacity-50"
        >
          {loading ? 'Elaborazione...' : form.paymentMethod === 'bonifico'
            ? 'Conferma ordine (pagamento tramite bonifico)'
            : 'Paga con carta →'}
        </button>
      </form>
    </div>
  )
}
