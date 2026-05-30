'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useCart } from '@/lib/cart'
import { calculateShipping, freeShippingRemaining } from '@/lib/shipping'
import { Trash2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

const COUNTRY_CODES = [
  'IT','DE','FR','ES','NL','BE','AT','CH','PL','PT','SE','DK','NO',
  'US','GB','CA','AU','JP','BR',
]

export default function CheckoutPage() {
  const t = useTranslations('checkout')
  const { items, remove, updateQty, total } = useCart()
  const [country, setCountry] = useState('IT')
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '', email: '', address: '', city: '', postalCode: '',
  })
  const [promoCode, setPromoCode] = useState('')
  const [promoStatus, setPromoStatus] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle')
  const [promoType, setPromoType] = useState<string | null>(null)
  const [promoData, setPromoData] = useState<{ discountPercent?: number; discountAmount?: number } | null>(null)

  const cartTotal = total()
  const baseShipping = calculateShipping(cartTotal, country)
  const freeShippingByPromo = promoType === 'free_shipping'
  const shipping = freeShippingByPromo
    ? { ...baseShipping, cost: 0, isFree: true }
    : baseShipping
  const proDiscount = promoType === 'percent_pro' ? (promoData?.discountAmount ?? 0) : 0
  const grandTotal = cartTotal + shipping.cost - proDiscount
  const remaining = freeShippingByPromo ? 0 : freeShippingRemaining(cartTotal, country)

  const applyPromo = async () => {
    if (!promoCode.trim()) return
    setPromoStatus('loading')
    try {
      const res = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: promoCode, total: cartTotal }),
      })
      const data = await res.json()
      if (data.valid) {
        setPromoType(data.type)
        setPromoStatus('valid')
        if (data.type === 'percent_pro') {
          setPromoData({ discountPercent: data.discountPercent, discountAmount: data.discountAmount })
        } else {
          setPromoData(null)
        }
      } else {
        setPromoStatus('invalid')
        setPromoData(null)
      }
    } catch {
      setPromoStatus('invalid')
      setPromoData(null)
    }
  }

  const removePromo = () => {
    setPromoCode('')
    setPromoType(null)
    setPromoStatus('idle')
    setPromoData(null)
  }

  if (items.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-24 text-center">
        <p className="text-xl font-medium mb-4">{t('empty')}</p>
        <Link href="/" className="text-sm underline" style={{ color: 'var(--accent)' }}>
          {t('backToShop')}
        </Link>
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
          promoCode: promoStatus === 'valid' ? promoCode : undefined,
          discountAmount: proDiscount > 0 ? proDiscount : undefined,
          discountLabel: promoData?.discountPercent ? `Sconto Foolish Pro ${promoData.discountPercent}%` : undefined,
        }),
      })
      const data = await res.json()
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl)
      } else {
        alert(t('errorOrder'))
      }
    } catch {
      alert(t('errorNetwork'))
    } finally {
      setLoading(false)
    }
  }

  const fields = ['name', 'email', 'address', 'city', 'postalCode'] as const

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8">{t('title')}</h1>

      <div className="grid md:grid-cols-[1fr_320px] gap-8">

        {/* Prodotti */}
        <div>
          {/* Free shipping bar */}
          {remaining > 0 && (
            <div className="rounded-lg p-3 mb-6 text-sm" style={{ backgroundColor: 'var(--muted)' }}>
              <div className="flex justify-between mb-2">
                <span dangerouslySetInnerHTML={{ __html: t('freeShippingAdd', { amount: remaining.toFixed(2) }) }} />
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
              {t('freeShippingApplied')}
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
                  {Object.keys(item.selectedAttrs).length > 0 && (
                    <div className="text-xs mt-1 space-y-0.5">
                      {Object.entries(item.selectedAttrs).map(([key, val]) => (
                        <p key={key} style={{ color: 'var(--muted-fg)' }}>
                          <span className="capitalize">{key.replace(/_/g, ' ')}</span>: <span className="capitalize">{val.replace(/-/g, ' ')}</span>
                        </p>
                      ))}
                    </div>
                  )}
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
            <h2 className="font-semibold text-lg">{t('shippingTitle')}</h2>

            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{t(`countries.${code}`)}</option>
              ))}
            </select>

            {fields.map((field) => (
              <input
                key={field}
                type={field === 'email' ? 'email' : 'text'}
                placeholder={t(`fields.${field}`)}
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
            <h2 className="font-semibold">{t('summaryTitle')}</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted-fg)' }}>{t('labelProducts')}</span>
                <span>{cartTotal.toFixed(2)}€</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted-fg)' }}>{t('labelShipping', { country })}</span>
                <span>{shipping.isFree ? <span style={{ color: '#4caf50' }}>{t('labelFree')}</span> : `${shipping.cost.toFixed(2)}€`}</span>
              </div>
              {promoType === 'percent_pro' && promoData && (
                <div className="flex justify-between" style={{ color: '#4caf50' }}>
                  <span>{t('promoProDiscount', { percent: promoData.discountPercent ?? 15 })}</span>
                  <span>−{promoData.discountAmount?.toFixed(2)}€</span>
                </div>
              )}
              {!shipping.isFree && (
                <p className="text-xs" style={{ color: 'var(--muted-fg)' }}>
                  {t('labelFreeAbove', { amount: shipping.freeAbove })}
                </p>
              )}
            </div>
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex justify-between font-bold">
                <span>{t('labelTotal')}</span>
                <span style={{ color: 'var(--accent)' }}>{grandTotal.toFixed(2)}€</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--muted-fg)' }}>{t('vatIncluded')}</p>
            </div>

            {/* Promo code */}
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              {promoStatus !== 'valid' ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t('promoPlaceholder')}
                    value={promoCode}
                    onChange={(e) => { setPromoCode(e.target.value); if (promoStatus === 'invalid') setPromoStatus('idle') }}
                    onKeyDown={(e) => e.key === 'Enter' && applyPromo()}
                    className="flex-1 px-3 py-1.5 rounded border text-sm"
                    style={{ backgroundColor: 'var(--muted)', borderColor: promoStatus === 'invalid' ? '#f44336' : 'var(--border)', color: 'var(--foreground)' }}
                  />
                  <button
                    onClick={applyPromo}
                    disabled={promoStatus === 'loading' || !promoCode.trim()}
                    className="px-3 py-1.5 rounded border text-sm font-medium transition-opacity disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    {promoStatus === 'loading' ? '…' : t('promoApply')}
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: '#4caf50' }}>
                    {promoType === 'percent_pro'
                      ? t('promoProActive', { percent: promoData?.discountPercent ?? 15 })
                      : t('promoFreeShipping')}
                  </span>
                  <button onClick={removePromo} className="text-xs underline" style={{ color: 'var(--muted-fg)' }}>{t('promoRemove')}</button>
                </div>
              )}
              {promoStatus === 'invalid' && (
                <p className="text-xs mt-1" style={{ color: '#f44336' }}>{t('promoInvalid')}</p>
              )}
            </div>

            <button
              onClick={handlePayment}
              disabled={loading || !form.name || !form.email || !form.address || !form.city || !form.postalCode}
              className="w-full py-3 rounded font-semibold text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent)', color: 'black' }}
            >
              {loading ? t('loading') : t('pay', { amount: grandTotal.toFixed(2) })}
            </button>

            <p className="text-xs text-center" style={{ color: 'var(--muted-fg)' }}>
              {t('securePayment')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
