'use client'

import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { useCart } from '@/lib/cart'
import { track } from '@/lib/analytics'
import { calculateShipping, freeShippingRemaining } from '@/lib/shipping'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { cmsImageUrl } from '@/lib/cms'

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
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', postalCode: '', phone: '' })
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
  const [phoneError, setPhoneError] = useState(false)

  // Address autocomplete
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus state
  const [focusedField, setFocusedField] = useState<string | null>(null)

  // Payment
  const [loading, setLoading] = useState(false)

  // Cart session capture for abandoned cart flow
  useEffect(() => {
    if (!form.email || !form.email.includes('@') || items.length === 0) return

    const timer = setTimeout(() => {
      fetch('/api/email/cart-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, cartData: items }),
      }).catch(() => {}) // fire-and-forget, never block checkout
    }, 2000)

    return () => clearTimeout(timer)
  }, [form.email, items])

  // ---- Derived ----
  const cartTotal = total()
  const baseShipping = calculateShipping(cartTotal, country)
  const freeShippingByPromo = promoType === 'free_shipping'
  const shipping = freeShippingByPromo ? { ...baseShipping, cost: 0, isFree: true } : baseShipping
  const proDiscount = (promoType === 'percent_pro' || promoType === 'percent' || promoType === 'amount')
  ? (promoData?.discountAmount ?? 0)
  : 0
  const grandTotal = cartTotal + shipping.cost - proDiscount
  const remaining = freeShippingByPromo ? 0 : freeShippingRemaining(cartTotal, country)

  const validatePhone = (phone: string) => /^[\d\s+\-()\u00AD]{6,}$/.test(phone.trim())

  const validatePostalCode = (code: string, c: string) => {
    const re = POSTAL_CODE_RE[c]
    return !re || re.test(code.trim())
  }

  const canPay =
    !loading &&
    !!form.name && !!form.email && !!form.address && !!form.city && !!form.postalCode &&
    !!form.phone && !phoneError &&
    emailStatus !== 'invalid' &&
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
        setPromoData(data.type === 'percent_pro' || data.type === 'percent'
          ? { discountPercent: data.discountPercent, discountAmount: data.discountAmount }
          : data.type === 'amount'
          ? { discountAmount: data.discountAmount }
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

  // ---- Email format validation ----
  const checkEmail = (email: string) => {
    if (!email) return
    const valid = email.includes('@') && email.split('@')[1]?.includes('.')
    setEmailStatus(valid ? 'valid' : 'invalid')
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
          discountLabel: promoType === 'percent_pro' && promoData?.discountPercent
            ? `Sconto Foolish Pro ${promoData.discountPercent}%`
            : promoType === 'percent' && promoData?.discountPercent
            ? `Sconto ${promoData.discountPercent}%`
            : promoType === 'amount'
            ? 'Sconto promozionale'
            : undefined,
        }),
      })
      const data = await res.json()
      if (data.checkoutUrl) {
        track('checkout_started', { total: grandTotal, items: items.length, country })
        // Il redirect stronca la pagina prima che il beacon Umami parta: piccolo ritardo per farlo partire.
        setTimeout(() => window.location.assign(data.checkoutUrl), 150)
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

  const inputBase = 'w-full px-3 py-2.5 rounded-lg border text-sm transition-[border-color,box-shadow]'

  const inputStyle = (field: string, overrideValid?: boolean) => {
    const focused = focusedField === field
    const isInvalid =
      (field === 'email' && emailStatus === 'invalid') ||
      (field === 'postalCode' && postalCodeError) ||
      (field === 'phone' && phoneError)
    const isValid = overrideValid ||
      (field === 'email' && emailStatus === 'valid') ||
      (field === 'postalCode' && !postalCodeError && !!form.postalCode) ||
      (field === 'phone' && !phoneError && !!form.phone)
    return {
      backgroundColor: 'var(--surface-1)',
      color: 'var(--foreground)',
      transitionDuration: 'var(--dur-fast)',
      borderColor: isInvalid
        ? 'rgba(192,57,43,0.5)'
        : isValid
        ? 'rgba(90,156,82,0.4)'
        : focused
        ? 'rgba(200,169,126,0.5)'
        : 'var(--border)',
      boxShadow: isInvalid
        ? '0 0 0 3px rgba(192,57,43,0.06)'
        : focused
        ? '0 0 0 3px var(--glow-strong)'
        : 'none',
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8">{t('title')}</h1>

      <div className="grid md:grid-cols-[1fr_320px] gap-8">

        {/* Left column */}
        <div>
          {/* Free shipping bar */}
          {remaining > 0 && (
            <div
              className="rounded-xl p-4 mb-6 border"
              style={{ backgroundColor: 'var(--surface-1)', borderColor: '#151515' }}
            >
              <div className="flex justify-between items-center mb-3">
                <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>
                  Aggiungi{' '}
                  <span className="font-medium" style={{ color: 'var(--accent)' }}>
                    €{remaining.toFixed(2)}
                  </span>{' '}
                  per la spedizione gratuita
                </p>
                <span className="text-mono text-xs" style={{ color: 'var(--muted-fg)' }}>
                  {Math.round((cartTotal / (cartTotal + remaining)) * 100)}%
                </span>
              </div>
              {/* Progress bar con dot glow */}
              <div className="relative h-0.5 rounded-full overflow-visible" style={{ backgroundColor: 'var(--border)' }}>
                <div
                  className="absolute left-0 top-0 h-0.5 rounded-full transition-[width]"
                  style={{
                    width: `${Math.min(100, (cartTotal / (cartTotal + remaining)) * 100)}%`,
                    background: 'linear-gradient(90deg, #a88b5e, var(--accent))',
                    transitionDuration: 'var(--dur-slow)',
                  }}
                >
                  <div
                    className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
                    style={{
                      backgroundColor: 'var(--accent)',
                      boxShadow: '0 0 6px rgba(200,169,126,0.6)',
                    }}
                  />
                </div>
              </div>
            </div>
          )}
          {remaining === 0 && (
            <div
              className="flex items-center gap-2 rounded-xl p-3.5 mb-6 border text-sm font-medium"
              style={{
                backgroundColor: 'rgba(45,140,39,0.08)',
                borderColor: 'rgba(45,140,39,0.2)',
                color: '#5a9c52',
              }}
            >
              <CheckCircle size={14} />
              {t('freeShippingApplied')}
            </div>
          )}

          {/* Cart items */}
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.sku} className="flex gap-4 p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
                {item.image && (
                  <div className="w-16 h-16 rounded overflow-hidden flex-shrink-0 relative border" style={{ backgroundColor: 'var(--muted)', border: '1px solid var(--surface-3)' }}>
                    <Image src={cmsImageUrl(item.image)} alt={item.productName} fill className="object-cover" sizes="64px" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-sm">{item.productName}</p>
                    {item.packName && (
                      <span
                        className="text-label px-1.5 py-0.5 rounded border"
                        style={{
                          backgroundColor: 'rgba(200,169,126,0.08)',
                          borderColor: 'rgba(200,169,126,0.2)',
                          color: 'var(--accent)',
                        }}
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
                    <button
                      onClick={() => remove(item.sku)}
                      className="text-xs transition-colors"
                      style={{ color: 'var(--muted-fg)', transitionDuration: 'var(--dur-fast)' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--limited)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-fg)' }}
                    >
                      ✕ Rimuovi
                    </button>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 flex flex-col justify-start gap-0.5">
                  {item.originalUnitPrice && (
                    <span className="text-xs line-through" style={{ color: 'var(--muted-fg)', opacity: 0.5 }}>
                      €{(item.originalUnitPrice * item.quantity).toFixed(2)}
                    </span>
                  )}
                  <span className="text-mono font-semibold text-sm">
                    €{(item.price * item.quantity).toFixed(2)}
                  </span>
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
              onFocus={() => setFocusedField('country')}
              onBlur={() => setFocusedField(null)}
              className={inputBase}
              style={inputStyle('country', !!country)}
            >
              {COUNTRY_CODES.map((code) => (
                <option key={code} value={code}>{t(`countries.${code}`)}</option>
              ))}
            </select>

            {/* Name */}
            <div className="relative">
              <input
                type="text"
                placeholder={t('fields.name')}
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                onFocus={() => setFocusedField('name')}
                onBlur={() => setFocusedField(null)}
                className={inputBase}
                style={inputStyle('name', !!form.name)}
              />
              {form.name && (
                <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />
              )}
            </div>

            {/* Email + MX check */}
            <div>
              <div className="relative">
                <input
                  type="email"
                  placeholder={t('fields.email')}
                  value={form.email}
                  onChange={(e) => { setForm(f => ({ ...f, email: e.target.value })); if (emailStatus !== 'idle') setEmailStatus('idle') }}
                  onFocus={() => setFocusedField('email')}
                  onBlur={(e) => { setFocusedField(null); checkEmail(e.target.value) }}
                  className={`${inputBase} pr-8`}
                  style={inputStyle('email')}
                />
                {emailStatus === 'checking' && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin pointer-events-none" style={{ color: 'var(--muted-fg)' }} />}
                {emailStatus === 'invalid' && <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--limited)' }} />}
                {emailStatus === 'valid' && <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />}
              </div>
              {emailStatus === 'invalid' && (
                <p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>Email non valida — ricontrolla</p>
              )}
            </div>

            {/* Phone */}
            <div>
              <div className="relative">
                <input
                  type="tel"
                  placeholder={t('fields.phone')}
                  value={form.phone}
                  onChange={(e) => { setForm(f => ({ ...f, phone: e.target.value })); if (phoneError) setPhoneError(false) }}
                  onFocus={() => setFocusedField('phone')}
                  onBlur={(e) => { setFocusedField(null); if (e.target.value) setPhoneError(!validatePhone(e.target.value)) }}
                  className={`${inputBase} pr-8`}
                  style={inputStyle('phone')}
                />
                {phoneError && <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--limited)' }} />}
                {!phoneError && form.phone && <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />}
              </div>
              {phoneError && (
                <p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>Numero di telefono non valido</p>
              )}
            </div>

            {/* Address + Nominatim autocomplete */}
            <div className="relative">
              <input
                type="text"
                placeholder={t('fields.address')}
                value={form.address}
                onChange={(e) => handleAddressChange(e.target.value)}
                onBlur={() => { setFocusedField(null); setTimeout(() => setShowSuggestions(false), 150) }}
                onFocus={() => { setFocusedField('address'); suggestions.length > 0 && setShowSuggestions(true) }}
                className={inputBase}
                style={inputStyle('address', !!form.address)}
                autoComplete="off"
              />
              {form.address && (
                <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />
              )}
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
            <div className="relative">
              <input
                type="text"
                placeholder={t('fields.city')}
                value={form.city}
                onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                onFocus={() => setFocusedField('city')}
                onBlur={() => setFocusedField(null)}
                className={inputBase}
                style={inputStyle('city', !!form.city)}
              />
              {form.city && (
                <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />
              )}
            </div>

            {/* Postal code + format validation */}
            <div>
              <div className="relative">
                <input
                  type="text"
                  placeholder={t('fields.postalCode')}
                  value={form.postalCode}
                  onChange={(e) => { setForm(f => ({ ...f, postalCode: e.target.value })); if (postalCodeError) setPostalCodeError(false) }}
                  onFocus={() => setFocusedField('postalCode')}
                  onBlur={() => { setFocusedField(null); handlePostalCodeBlur() }}
                  className={inputBase}
                  style={inputStyle('postalCode')}
                />
                {postalCodeError && <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--limited)' }} />}
                {!postalCodeError && form.postalCode && <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />}
              </div>
              {postalCodeError && (
                <p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>Formato CAP non valido per {country}</p>
              )}
            </div>

            {/* Codice Fiscale / P.IVA — Italy only */}
            {country === 'IT' && (
              <div className="relative">
                <input
                  type="text"
                  placeholder={t('fields.fiscalCode')}
                  value={fiscalCode}
                  onChange={(e) => setFiscalCode(e.target.value.toUpperCase())}
                  onFocus={() => setFocusedField('fiscalCode')}
                  onBlur={() => setFocusedField(null)}
                  className={inputBase}
                  style={inputStyle('fiscalCode', !!fiscalCode)}
                />
                {fiscalCode && (
                  <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />
                )}
              </div>
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

            {/* Riepilogo */}
            <div className="space-y-0 mb-3">
              <p className="text-label mb-3" style={{ color: 'var(--muted-fg)' }}>Riepilogo ordine</p>

              <div className="flex justify-between py-2" style={{ borderBottom: '1px solid var(--surface-3)' }}>
                <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>Subtotale</span>
                <span className="text-mono text-sm">€{cartTotal.toFixed(2)}</span>
              </div>

              <div className="flex justify-between py-2" style={{ borderBottom: '1px solid var(--surface-3)' }}>
                <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>Spedizione — {country}</span>
                <span className="text-mono text-sm" style={{ color: shipping.isFree ? '#5a9c52' : 'var(--foreground)' }}>
                  {shipping.isFree ? 'Gratuita' : `€${shipping.cost.toFixed(2)}`}
                </span>
              </div>

              {proDiscount > 0 && (
                <div className="flex justify-between py-2" style={{ borderBottom: '1px solid var(--surface-3)' }}>
                  <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>
                    {promoData?.discountPercent ? `Sconto ${promoData.discountPercent}%` : 'Sconto'}
                  </span>
                  <span className="text-mono text-sm" style={{ color: '#5a9c52' }}>−€{proDiscount.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="h-px mb-3" style={{ backgroundColor: 'var(--border)' }} />

            {/* Totale */}
            <div className="flex justify-between items-baseline mb-4">
              <span className="text-sm font-medium">Totale IVA inc.</span>
              <span className="text-mono font-bold" style={{ fontSize: 22, color: 'var(--accent)', letterSpacing: '-0.01em' }}>
                €{grandTotal.toFixed(2)}
              </span>
            </div>

            {/* Promo code */}
            <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex gap-2 mb-2">
                <input
                  className={`${inputBase} flex-1 text-mono uppercase`}
                  style={inputStyle('promo')}
                  placeholder="CODICE PROMO"
                  value={promoCode}
                  onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                  onFocus={() => setFocusedField('promo')}
                  onBlur={() => setFocusedField(null)}
                  disabled={promoStatus === 'valid'}
                />
                <button
                  onClick={applyPromo}
                  disabled={promoStatus === 'loading' || promoStatus === 'valid' || !promoCode.trim()}
                  className="text-label px-4 rounded-lg border flex-shrink-0 transition-[border-color,background-color] disabled:opacity-40"
                  style={{
                    borderColor: 'rgba(200,169,126,0.2)',
                    color: 'var(--accent)',
                    transitionDuration: 'var(--dur-fast)',
                  }}
                >
                  {promoStatus === 'loading' ? <Loader2 size={14} className="animate-spin" /> : 'Applica'}
                </button>
              </div>
              {promoStatus === 'valid' && (
                <div
                  className="flex items-center justify-between p-3 rounded-lg border text-sm"
                  style={{
                    backgroundColor: 'rgba(45,140,39,0.08)',
                    borderColor: 'rgba(45,140,39,0.2)',
                    color: '#5a9c52',
                  }}
                >
                  <span className="flex items-center gap-2">
                    <CheckCircle size={14} />
                    {promoCode} · {
                      promoData?.discountPercent
                        ? `−${promoData.discountPercent}%`
                        : promoType === 'amount' && promoData?.discountAmount
                        ? `−€${promoData.discountAmount.toFixed(2)}`
                        : 'Spedizione gratuita'
                    }
                  </span>
                  <button onClick={removePromo} className="text-label" style={{ color: 'var(--muted-fg)' }}>
                    Rimuovi
                  </button>
                </div>
              )}
              {promoStatus === 'invalid' && (
                <p className="flex items-center gap-1.5 text-xs mt-1" style={{ color: 'var(--limited)' }}>
                  <XCircle size={12} /> Codice non valido o scaduto
                </p>
              )}
            </div>

            <button
              onClick={handlePayment}
              disabled={!canPay}
              className="relative w-full overflow-hidden rounded-lg text-label font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
              style={{ height: 56, backgroundColor: 'var(--accent)', color: '#080808' }}
            >
              <span
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 55%)' }}
                aria-hidden
              />
              {loading
                ? <Loader2 size={18} className="animate-spin" />
                : <>{t('pay', { amount: grandTotal.toFixed(2) })}</>
              }
            </button>
            <p className="text-center mt-2.5 text-xs" style={{ color: 'var(--muted-fg)' }}>
              🔒 Stripe · Pagamento sicuro · Dati crittografati
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
