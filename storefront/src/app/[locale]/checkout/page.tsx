'use client'

import { useState, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useCart } from '@/lib/cart'
import { track } from '@/lib/analytics'
import { calculateShipping, freeShippingRemaining } from '@/lib/shipping'
import { Trash2, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'

const COUNTRY_CODES = [
  'IT','DE','FR','ES','NL','BE','AT','CH','PL','PT','SE','DK','NO',
  'US','GB','CA','AU','JP','BR',
]

// Postal code format per country
const POSTAL_CODE_RE: Record<string, RegExp> = {
  IT: /^\d{5}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  ES: /^\d{5}$/,
  NL: /^\d{4}\s?[A-Za-z]{2}$/,
  BE: /^\d{4}$/,
  AT: /^\d{4}$/,
  CH: /^\d{4}$/,
  PL: /^\d{2}-\d{3}$/,
  PT: /^\d{4}-\d{3}$/,
  SE: /^\d{3}\s?\d{2}$/,
  DK: /^\d{4}$/,
  NO: /^\d{4}$/,
  US: /^\d{5}(-\d{4})?$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
  CA: /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i,
  AU: /^\d{4}$/,
  JP: /^\d{3}-?\d{4}$/,
  BR: /^\d{5}-?\d{3}$/,
}

interface AddressSuggestion {
  label: string
  road: string
  houseNumber: string
  city: string
  postcode: string
  countryCode: string
}

export default function CheckoutPage() {
  const t = useTranslations('checkout')
  const { items, remove, updateQty, total } = useCart()

  // Shipping
  const [country, setCountry] = useState('IT')

  // Shipping form
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', postalCode: '' })
  const [fiscalCode, setFiscalCode] = useState('')

  // Billing
  const [billingDifferent, setBillingDifferent] = useState(false)
  const [billing, setBilling] = useState({ name: '', address: '', city: '', postalCode: '', country: 'IT' })

  // Promo
  const [promoCode, setPromoCode] = useState('')
  const [promoStatus, setPromoStatus] = useState<'idle' | 'loading' | 'valid' | 'invalid'>('idle')
  const [promoType, setPromoType] = useState<string | null>(null)
  const [promoData, setPromoData] = useState<{ discountPercent?: number; discountAmount?: number } | null>(null)

  // Validation state
  const [emailStatus, setEmailStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle')
  const [postalCodeError, setPostalCodeError] = useState(false)

  // Address autocomplete
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Payment
  const [loading, setLoading] = useState(false)

  // ---- Derived ----
  const cartTotal = total()
  const baseShipping = calculateShipping(cartTotal, country)
  const freeShippingByPromo = promoType === 'free_shipping'
  const shipping = freeShippingByPromo ? { ...baseShipping, cost: 0, isFree: true } : baseShipping
  const proDiscount = promoType === 'percent_pro' ? (promoData?.discountAmount ?? 0) : 0
  const grandTotal = cartTotal + shipping.cost - proDiscount
  const remaining = freeShippingByPromo ? 0 : freeShippingRemaining(cartTotal, country)

  const validatePostalCode = (code: string, c: string) => {
    const re = POSTAL_CODE_RE[c]
    return !re || re.test(code.trim())
  }

  const canPay =
    !loading &&
    !!form.name && !!form.email && !!form.address && !!form.city && !!form.postalCode &&
    emailStatus !== 'invalid' &&
    emailStatus !== 'checking' &&
    !postalCodeError &&
    (!billingDifferent || (!!billing.name && !!billing.address && !!billing.city && !!billing.postalCode))

  // ---- Promo ----
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
        setPromoData(data.type === 'percent_pro'
          ? { discountPercent: data.discountPercent, discountAmount: data.discountAmount }
          : null)
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

  // ---- Email MX validation ----
  const checkEmail = async (email: string) => {
    if (!email.includes('@') || !email.split('@')[1]?.includes('.')) return
    setEmailStatus('checking')
    try {
      const res = await fetch('/api/validate/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const { valid } = await res.json()
      setEmailStatus(valid ? 'valid' : 'invalid')
    } catch {
      setEmailStatus('idle') // fail open — never block payment on our own API error
    }
  }

  // ---- Postal code ----
  const handlePostalCodeBlur = () => {
    if (form.postalCode) setPostalCodeError(!validatePostalCode(form.postalCode, country))
  }

  // ---- Address autocomplete ----
  const fetchSuggestions = async (q: string) => {
    if (q.length < 3) { setSuggestions([]); return }
    try {
      const res = await fetch(`/api/address/autocomplete?q=${encodeURIComponent(q)}&countrycode=${country}`)
      if (res.ok) setSuggestions(await res.json())
    } catch { /* ignore — autocomplete is best-effort */ }
  }

  const handleAddressChange = (val: string) => {
    setForm(f => ({ ...f, address: val }))
    setShowSuggestions(true)
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    suggestTimer.current = setTimeout(() => fetchSuggestions(val), 400)
  }

  const selectSuggestion = (s: AddressSuggestion) => {
    const addr = [s.road, s.houseNumber].filter(Boolean).join(' ')
    setForm(f => ({
      ...f,
      address: addr || f.address,
      city: s.city || f.city,
      postalCode: s.postcode || f.postalCode,
    }))
    if (s.postcode) setPostalCodeError(!validatePostalCode(s.postcode, country))
    setSuggestions([])
    setShowSuggestions(false)
  }

  // ---- Payment ----
  const handlePayment = async () => {
    if (!validatePostalCode(form.postalCode, country)) { setPostalCodeError(true); return }
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
          fiscalCode: fiscalCode || undefined,
          billingAddress: billingDifferent ? billing : undefined,
          promoCode: promoStatus === 'valid' ? promoCode : undefined,
          discountAmount: proDiscount > 0 ? proDiscount : undefined,
          discountLabel: promoData?.discountPercent ? `Sconto Foolish Pro ${promoData.discountPercent}%` : undefined,
        }),
      })
      const data = await res.json()
      if (data.checkoutUrl) {
        track('checkout_started', { total: grandTotal, items: items.length, country })
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

  const inputBase = 'w-full px-3 py-2 rounded border text-sm'
  const inputStyle = { backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8">{t('title')}</h1>

      <div className="grid md:grid-cols-[1fr_320px] gap-8">

        {/* Left column */}
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
                  style={{ backgroundColor: 'var(--accent)', width: `${Math.min(100, (cartTotal / (cartTotal + remaining)) * 100)}%` }}
                />
              </div>
            </div>
          )}
          {remaining === 0 && (
            <div className="rounded-lg p-3 mb-6 text-sm font-medium" style={{ backgroundColor: 'var(--muted)', color: '#4caf50' }}>
              {t('freeShippingApplied')}
            </div>
          )}

          {/* Cart items */}
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.sku} className="flex gap-4 p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                {item.image && (
                  <div className="w-16 h-16 rounded overflow-hidden flex-shrink-0 relative" style={{ backgroundColor: 'var(--muted)' }}>
                    <Image src={item.image} alt={item.productName} fill className="object-cover" sizes="64px" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{item.productName}</p>
                    {item.packName && (
                      <span
                        className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--accent)', color: 'black' }}
                      >
                        {item.packName}
                      </span>
                    )}
                  </div>
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
                  {item.originalUnitPrice && (
                    <p className="text-xs line-through opacity-40" style={{ color: 'var(--foreground)' }}>
                      {(item.originalUnitPrice * item.quantity).toFixed(2)}€
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Shipping form */}
          <div className="mt-8 space-y-4">
            <h2 className="font-semibold text-lg">{t('shippingTitle')}</h2>

            {/* Country */}
            <select
              value={country}
              onChange={(e) => { setCountry(e.target.value); setPostalCodeError(false) }}
              className={inputBase}
              style={inputStyle}
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{t(`countries.${code}`)}</option>
              ))}
            </select>

            {/* Name */}
            <input
              type="text"
              placeholder={t('fields.name')}
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              className={inputBase}
              style={inputStyle}
            />

            {/* Email + MX check */}
            <div>
              <div className="relative">
                <input
                  type="email"
                  placeholder={t('fields.email')}
                  value={form.email}
                  onChange={(e) => { setForm(f => ({ ...f, email: e.target.value })); if (emailStatus !== 'idle') setEmailStatus('idle') }}
                  onBlur={(e) => checkEmail(e.target.value)}
                  className={`${inputBase} pr-8`}
                  style={{ ...inputStyle, borderColor: emailStatus === 'invalid' ? '#f44336' : emailStatus === 'valid' ? '#4caf50' : 'var(--border)' }}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  {emailStatus === 'checking' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--muted-fg)' }} />}
                  {emailStatus === 'valid' && <CheckCircle size={14} style={{ color: '#4caf50' }} />}
                  {emailStatus === 'invalid' && <XCircle size={14} style={{ color: '#f44336' }} />}
                </span>
              </div>
              {emailStatus === 'invalid' && (
                <p className="text-xs mt-1" style={{ color: '#f44336' }}>{t('emailInvalid')}</p>
              )}
            </div>

            {/* Address + Nominatim autocomplete */}
            <div className="relative">
              <input
                type="text"
                placeholder={t('fields.address')}
                value={form.address}
                onChange={(e) => handleAddressChange(e.target.value)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className={inputBase}
                style={inputStyle}
                autoComplete="off"
              />
              {showSuggestions && suggestions.length > 0 && (
                <div
                  className="absolute z-50 w-full mt-1 rounded border shadow-lg overflow-hidden"
                  style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={() => selectSuggestion(s)}
                      className="w-full text-left px-3 py-2 text-xs transition-opacity hover:opacity-70 border-b last:border-b-0"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)', backgroundColor: 'var(--card)' }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* City */}
            <input
              type="text"
              placeholder={t('fields.city')}
              value={form.city}
              onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
              className={inputBase}
              style={inputStyle}
            />

            {/* Postal code + format validation */}
            <div>
              <input
                type="text"
                placeholder={t('fields.postalCode')}
                value={form.postalCode}
                onChange={(e) => { setForm(f => ({ ...f, postalCode: e.target.value })); if (postalCodeError) setPostalCodeError(false) }}
                onBlur={handlePostalCodeBlur}
                className={inputBase}
                style={{ ...inputStyle, borderColor: postalCodeError ? '#f44336' : 'var(--border)' }}
              />
              {postalCodeError && (
                <p className="text-xs mt-1" style={{ color: '#f44336' }}>{t('postalCodeInvalid')}</p>
              )}
            </div>

            {/* Codice Fiscale / P.IVA — Italy only */}
            {country === 'IT' && (
              <input
                type="text"
                placeholder={t('fields.fiscalCode')}
                value={fiscalCode}
                onChange={(e) => setFiscalCode(e.target.value.toUpperCase())}
                className={inputBase}
                style={inputStyle}
              />
            )}
          </div>

          {/* Billing address */}
          <div className="mt-6 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm select-none">
              <input
                type="checkbox"
                checked={!billingDifferent}
                onChange={(e) => setBillingDifferent(!e.target.checked)}
                className="rounded"
              />
              {t('billingSameAsShipping')}
            </label>

            {billingDifferent && (
              <div className="space-y-3 p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
                <h3 className="font-medium text-sm">{t('billingTitle')}</h3>

                <input
                  type="text"
                  placeholder={t('fields.name')}
                  value={billing.name}
                  onChange={(e) => setBilling(b => ({ ...b, name: e.target.value }))}
                  className={inputBase}
                  style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
                <input
                  type="text"
                  placeholder={t('fields.address')}
                  value={billing.address}
                  onChange={(e) => setBilling(b => ({ ...b, address: e.target.value }))}
                  className={inputBase}
                  style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    placeholder={t('fields.city')}
                    value={billing.city}
                    onChange={(e) => setBilling(b => ({ ...b, city: e.target.value }))}
                    className={inputBase}
                    style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  />
                  <input
                    type="text"
                    placeholder={t('fields.postalCode')}
                    value={billing.postalCode}
                    onChange={(e) => setBilling(b => ({ ...b, postalCode: e.target.value }))}
                    className={inputBase}
                    style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  />
                </div>
                <select
                  value={billing.country}
                  onChange={(e) => setBilling(b => ({ ...b, country: e.target.value }))}
                  className={inputBase}
                  style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                >
                  {COUNTRY_CODES.map((code) => (
                    <option key={code} value={code}>{t(`countries.${code}`)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Order summary — sticky sidebar */}
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
                <span>
                  {shipping.isFree
                    ? <span style={{ color: '#4caf50' }}>{t('labelFree')}</span>
                    : `${shipping.cost.toFixed(2)}€`}
                </span>
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
              disabled={!canPay}
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
