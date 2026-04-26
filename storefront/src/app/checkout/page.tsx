'use client'

import { useState } from 'react'
import { useCart } from '@/lib/cart'
import { calculateShipping, freeShippingRemaining } from '@/lib/shipping'
import { Trash2 } from 'lucide-react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'

const EU_COUNTRY_OPTIONS = [
  { code: 'IT', name: 'Italia' },
  { code: 'DE', name: 'Germania' },
  { code: 'FR', name: 'Francia' },
  { code: 'ES', name: 'Spagna' },
  { code: 'NL', name: 'Paesi Bassi' },
  { code: 'BE', name: 'Belgio' },
  { code: 'AT', name: 'Austria' },
  { code: 'CH', name: 'Svizzera' },
  { code: 'PL', name: 'Polonia' },
  { code: 'PT', name: 'Portogallo' },
  { code: 'SE', name: 'Svezia' },
  { code: 'DK', name: 'Danimarca' },
  { code: 'NO', name: 'Norvegia' },
  { code: 'US', name: 'USA' },
  { code: 'GB', name: 'Regno Unito' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'JP', name: 'Giappone' },
  { code: 'BR', name: 'Brasile' },
  { code: 'OTHER', name: 'Altro paese' },
]

export default function CheckoutPage() {
  const { items, remove, updateQty, total, clear } = useCart()
  const router = useRouter()
  const [country, setCountry] = useState('IT')
  const [step, setStep] = useState<'cart' | 'shipping' | 'payment'>('cart')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    address: '', city: '', postalCode: '',
  })

  const cartTotal = total()
  const shipping = calculateShipping(cartTotal, country)
  const grandTotal = cartTotal + shipping.cost
  const remaining = freeShippingRemaining(cartTotal, country)

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <p className="text-xl font-medium mb-4">Il carrello è vuoto.</p>
        <a href="/" className="text-sm underline" style={{ color: 'var(--accent)' }}>
          Torna alla vetrina →
        </a>
      </div>
    )
  }

  const handlePayment = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          shippingCost: shipping.cost,
          total: grandTotal,
          customer: { ...form, country },
        }),
      })
      const data = await res.json()
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl
      } else {
        alert('Errore nel creare l\'ordine. Riprova.')
      }
    } catch {
      alert('Errore di rete. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8">Carrello</h1>

      <div className="grid md:grid-cols-[1fr_320px] gap-8">

        {/* Prodotti */}
        <div>
          {/* Free shipping bar */}
          {remaining > 0 && (
            <div className="rounded-lg p-3 mb-6 text-sm" style={{ backgroundColor: 'var(--muted)' }}>
              <div className="flex justify-between mb-2">
                <span>Aggiungi <strong>{remaining.toFixed(2)}€</strong> per la spedizione gratuita</span>
                <span style={{ color: 'var(--muted-fg)' }}>{country}</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    backgroundColor: 'var(--accent)',
                    width: `${Math.min(100, (cartTotal / (cartTotal + remaining)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {remaining === 0 && (
            <div className="rounded-lg p-3 mb-6 text-sm font-medium" style={{ backgroundColor: 'var(--muted)', color: '#4caf50' }}>
              ✓ Spedizione gratuita applicata
            </div>
          )}

          {/* Lista items */}
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.sku} className="flex gap-4 p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                {item.image && (
                  <div className="w-16 h-16 rounded overflow-hidden flex-shrink-0 relative" style={{ backgroundColor: 'var(--muted)' }}>
                    <Image src={item.image} alt={item.productName} fill className="object-cover" sizes="64px" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{item.productName}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>{item.variantLabel}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex items-center gap-1 border rounded" style={{ borderColor: 'var(--border)' }}>
                      <button className="w-7 h-7 flex items-center justify-center text-sm" onClick={() => updateQty(item.sku, item.quantity - 1)}>−</button>
                      <span className="w-6 text-center text-sm">{item.quantity}</span>
                      <button className="w-7 h-7 flex items-center justify-center text-sm" onClick={() => updateQty(item.sku, item.quantity + 1)}>+</button>
                    </div>
                    <button onClick={() => remove(item.sku)} className="p-1" style={{ color: 'var(--muted-fg)' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className="font-semibold text-sm">{(item.price * item.quantity).toFixed(2)}€</span>
                </div>
              </div>
            ))}
          </div>

          {/* Form dati */}
          <div className="mt-8 space-y-4">
            <h2 className="font-semibold text-lg">Dati spedizione</h2>

            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              {EU_COUNTRY_OPTIONS.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>

            {(['name', 'email', 'address', 'city', 'postalCode'] as const).map((field) => (
              <input
                key={field}
                type={field === 'email' ? 'email' : 'text'}
                placeholder={{ name: 'Nome e cognome', email: 'Email', address: 'Indirizzo', city: 'Città', postalCode: 'CAP' }[field]}
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full px-3 py-2 rounded border text-sm"
                style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              />
            ))}
          </div>
        </div>

        {/* Riepilogo ordine */}
        <div className="sticky top-20 h-fit">
          <div className="rounded-lg border p-5 space-y-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
            <h2 className="font-semibold">Riepilogo</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted-fg)' }}>Prodotti</span>
                <span>{cartTotal.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted-fg)' }}>Spedizione ({country})</span>
                <span>{shipping.isFree ? <span style={{ color: '#4caf50' }}>Gratuita</span> : `${shipping.cost.toFixed(2)}€`}</span>
              </div>
              {!shipping.isFree && (
                <p className="text-xs" style={{ color: 'var(--muted-fg)' }}>
                  Gratuita sopra {shipping.freeAbove}€
                </p>
              )}
            </div>
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex justify-between font-bold">
                <span>Totale</span>
                <span style={{ color: 'var(--accent)' }}>{grandTotal.toFixed(2)}€</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--muted-fg)' }}>IVA inclusa</p>
            </div>

            <button
              onClick={handlePayment}
              disabled={loading || !form.name || !form.email || !form.address || !form.city || !form.postalCode}
              className="w-full py-3 rounded font-semibold text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent)', color: 'black' }}
            >
              {loading ? 'Attendere...' : `Paga ${grandTotal.toFixed(2)}€`}
            </button>

            <p className="text-xs text-center" style={{ color: 'var(--muted-fg)' }}>
              Pagamento sicuro · Stripe · Carta · Apple Pay · Google Pay
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
