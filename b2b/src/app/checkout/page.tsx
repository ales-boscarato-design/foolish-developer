'use client'
import { useState, useEffect } from 'react'
import { useCart } from '@/lib/cart'
import { formatPrice } from '@/lib/pricing'
import { calculateResellerShipping } from '@/lib/shipping'
import {
  IDEMPOTENCY_STORAGE_KEY,
  cartFingerprint,
  getOrCreateIdempotencyKey,
} from '@/lib/idempotency'
import {
  applyPriceUpdate,
  decideAfterCheckoutFailure,
  diffCartPrices,
  type CartPriceDiff,
  type CartPricesResponse,
} from '@/lib/cart-reconcile'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const COUNTRY_CODES = [
  'IT','DE','FR','ES','NL','BE','AT','CH','PL','PT','SE','DK','NO',
  'US','GB','CA','AU','JP','BR','OTHER',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Il corpo della rotta prezzi e' usabile solo se porta un array di righe. */
function isPricesResponse(value: unknown): value is CartPricesResponse {
  return isRecord(value) && Array.isArray(value.items)
}

/** Nessuna navigazione verso Stripe senza un client secret vero. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

interface FormData {
  /** Ospite: chi compra senza account. Precompilata dalla sessione se c'e'. */
  email: string
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
  const { items, total, clear, replaceItems } = useCart()
  const router = useRouter()
  const t = useTranslations('Checkout')
  const [loading, setLoading] = useState(false)
  // Messaggio traducibile dell'ultimo rifiuto: niente `alert`, niente testo
  // scritto a mano nella pagina.
  const [checkoutErrorKey, setCheckoutErrorKey] = useState<string | null>(null)
  // Pannello di revisione: si apre solo dopo un rifiuto e resta aperto finche'
  // il cliente non sceglie "Aggiorna carrello" o "Annulla".
  const [priceReview, setPriceReview] = useState<{
    prices: CartPricesResponse
    diff: CartPriceDiff
  } | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)
  // Esito della verifica VIES sulla partita IVA. `null` = non ancora
  // controllata. Vedi src/lib/vies.ts per perche' "unverified" non
  // blocca l'ordine.
  const [vat, setVat] = useState<{ status: string; name?: string; detail?: string } | null>(null)
  const [vatChecking, setVatChecking] = useState(false)
  const [isGuest, setIsGuest] = useState(true)

  async function verifyVat(value: string) {
    if (!value.trim()) { setVat(null); return }
    setVatChecking(true)
    try {
      const res = await fetch('/api/vat/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vat: value }),
      })
      const data = await res.json()
      setVat(data)
      // Il registro conosce la ragione sociale ufficiale: se il campo e'
      // ancora vuoto la propone, senza mai sovrascrivere quanto digitato.
      if (data?.status === 'valid' && data?.name) {
        setForm(f => (f.businessName.trim() ? f : { ...f, businessName: data.name }))
      }
    } catch {
      setVat({ status: 'unverified', detail: 'verifica non riuscita' })
    } finally {
      setVatChecking(false)
    }
  }
  const [form, setForm] = useState<FormData>({
    email: '', businessName: '', vatNumber: '', sdiCode: '', billingAddress1: '', billingCity: '',
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
          setIsGuest(false)
          setForm(f => ({
            ...f,
            email: data.session.email ?? '',
            businessName: data.session.businessName ?? '',
            vatNumber: data.session.vatNumber ?? '',
            shippingName: data.session.businessName ?? '',
          }))
        }
      })
      .catch(() => { /* pre-fill is best-effort; form remains blank */ })
  }, [])

  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])
  useEffect(() => {
    if (hydrated && items.length === 0) router.replace('/carrello')
  }, [hydrated, items.length, router])

  const cartTotal = total()
  const shipping = calculateResellerShipping(cartTotal, form.shippingCountry)
  const baseTotal = cartTotal + shipping.cost
  // Nessun sovrapprezzo su Stripe (2026-07-29): allineato allo
  // storefront retail. Il totale e' lo stesso qualunque metodo si
  // scelga, quindi non c'e' piu' una cifra che cambia sotto gli occhi
  // di chi seleziona la carta.
  const stripeTotal = baseTotal
  const displayTotal = baseTotal
  const reviewHasUnavailable = priceReview?.diff.rows.some(row => !row.available) ?? false
  const orderBlocked = loading || reviewLoading || priceReview !== null

  function set(field: keyof FormData, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  /**
   * Legge i prezzi autorevoli per il pannello di revisione. E' sola lettura:
   * non aggiorna il carrello e non invia nulla. L'applicazione avviene solo
   * nel gestore del pulsante "Aggiorna carrello".
   */
  async function loadPriceReview(): Promise<void> {
    setReviewLoading(true)
    try {
      const res = await fetch('/api/cart/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(item => ({ variantSku: item.variantSku, qty: item.qty })),
        }),
      })
      const data: unknown = await res.json().catch(() => null)
      if (!res.ok || !isPricesResponse(data)) {
        setCheckoutErrorKey('errorGenerico')
        return
      }
      setPriceReview({ prices: data, diff: diffCartPrices(items, data) })
    } catch {
      setCheckoutErrorKey('errorGenerico')
    } finally {
      setReviewLoading(false)
    }
  }

  async function showCheckoutFailure(
    status: number,
    data: unknown,
    fingerprint: string,
  ): Promise<void> {
    const decision = decideAfterCheckoutFailure(status, data)
    setCheckoutErrorKey(decision.messageKey)

    // Una chiave rifiutata (per esempio troppo vecchia o corrotta) non deve
    // bloccare per sempre: la si scarta e la prossima richiesta ne genera una.
    if (decision.regenerateKey) {
      sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY)
      getOrCreateIdempotencyKey(fingerprint, sessionStorage)
    }

    // Solo la revisione apre il pannello. Un errore generico non tocca il
    // carrello e non naviga da nessuna parte.
    if (decision.action === 'revisione') await loadPriceReview()
  }

  function applyReview(): void {
    if (!priceReview) return
    // Unico punto in cui i prezzi riconciliati entrano nel carrello.
    replaceItems(applyPriceUpdate(items, priceReview.prices))
    setPriceReview(null)
    setCheckoutErrorKey(null)
  }

  function cancelReview(): void {
    setPriceReview(null)
    setCheckoutErrorKey(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || reviewLoading || priceReview) return
    setLoading(true)
    setCheckoutErrorKey(null)
    // Una chiave per invio, derivata dal contenuto: un retry dello stesso
    // checkout riusa la chiave, un carrello modificato ne ottiene una nuova.
    const fingerprint = cartFingerprint(items, form)
    const idempotencyKey = getOrCreateIdempotencyKey(fingerprint, sessionStorage)
    try {
      if (form.paymentMethod === 'stripe') {
        const res = await fetch('/api/stripe/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ form, items, total: stripeTotal, idempotencyKey }),
        })
        const data: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          await showCheckoutFailure(res.status, data, fingerprint)
          return
        }
        const clientSecret = isRecord(data) ? data.clientSecret : undefined
        const orderNumber = isRecord(data) ? data.orderNumber : undefined
        // Nessuna navigazione se il server non ha restituito un client secret
        // vero: senza, /checkout/stripe-pay fallirebbe senza spiegazione.
        if (!isNonEmptyString(clientSecret)) {
          setCheckoutErrorKey('errorGenerico')
          return
        }
        sessionStorage.setItem('stripe_order', JSON.stringify({ clientSecret, orderNumber, form }))
        router.push('/checkout/stripe-pay')
        return
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items, total: cartTotal, idempotencyKey }),
      })
      const data: unknown = await res.json().catch(() => null)

      if (res.ok) {
        const orderNumber = isRecord(data) ? data.orderNumber : undefined
        if (!isNonEmptyString(orderNumber)) {
          setCheckoutErrorKey('errorGenerico')
          return
        }
        clear()
        router.push(`/checkout/conferma?ordine=${orderNumber}&metodo=bonifico`)
      } else {
        await showCheckoutFailure(res.status, data, fingerprint)
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
        {t('titolo')}
      </h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>

        {/* FATTURAZIONE */}
        <section>
          <h2 style={sectionHeadStyle}>{t('fatturazione')}</h2>
          <div className="checkout-grid">
            {isGuest && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Email</label>
                <input required type="email" style={inputStyle} value={form.email}
                  onChange={e => set('email', e.target.value)}
                  placeholder="ordini@tuaazienda.it" />
                <p style={{ fontSize: '0.72rem', opacity: 0.6, margin: '0.35rem 0 0' }}>
                  Ci mandiamo la conferma d&apos;ordine. Da qui creiamo il tuo
                  accesso allo storico: nessuna password da scegliere adesso.
                </p>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('ragioneSociale')}</label>
              <input required style={inputStyle} value={form.businessName}
                onChange={e => set('businessName', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('piva')}</label>
              <input required style={inputStyle} value={form.vatNumber}
                onChange={e => set('vatNumber', e.target.value)}
                onBlur={e => verifyVat(e.target.value)}
                placeholder="IT12345678901" />
              {vatChecking && (
                <p style={{ fontSize: '0.72rem', opacity: 0.6, margin: '0.35rem 0 0' }}>
                  Verifica in corso…
                </p>
              )}
              {!vatChecking && vat?.status === 'valid' && (
                <p style={{ fontSize: '0.72rem', color: '#7ac77a', margin: '0.35rem 0 0' }}>
                  ✓ Verificata{vat.name ? ` — ${vat.name}` : ''}
                </p>
              )}
              {!vatChecking && vat?.status === 'invalid' && (
                <p style={{ fontSize: '0.72rem', color: '#e08585', margin: '0.35rem 0 0' }}>
                  Non risulta nel registro UE. Controlla il numero, prefisso
                  del paese incluso.
                </p>
              )}
              {!vatChecking && vat?.status === 'unverified' && (
                <p style={{ fontSize: '0.72rem', opacity: 0.6, margin: '0.35rem 0 0' }}>
                  Non siamo riusciti a verificarla ora — l&apos;ordine parte
                  lo stesso, la controlliamo noi.
                </p>
              )}
            </div>
            <div>
              <label style={labelStyle}>{t('sdi')}</label>
              <input required style={inputStyle} value={form.sdiCode}
                onChange={e => set('sdiCode', e.target.value)} placeholder={t('sdiPlaceholder')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('indirizzoBilling')}</label>
              <input required style={inputStyle} value={form.billingAddress1}
                onChange={e => set('billingAddress1', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('citta')}</label>
              <input required style={inputStyle} value={form.billingCity}
                onChange={e => set('billingCity', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('cap')}</label>
              <input required style={inputStyle} value={form.billingPostalCode}
                onChange={e => set('billingPostalCode', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('paese')}</label>
              <select required style={inputStyle} value={form.billingCountry}
                onChange={e => set('billingCountry', e.target.value)}>
                {COUNTRY_CODES.map(code => (
                  <option key={code} value={code}>{t(`countries.${code}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* SPEDIZIONE */}
        <section>
          <h2 style={sectionHeadStyle}>{t('spedizione')}</h2>
          <div className="checkout-grid">
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('paese')}</label>
              <select required style={inputStyle} value={form.shippingCountry}
                onChange={e => set('shippingCountry', e.target.value)}>
                {COUNTRY_CODES.map(code => (
                  <option key={code} value={code}>{t(`countries.${code}`)}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('nomeDestinatario')}</label>
              <input required style={inputStyle} value={form.shippingName}
                onChange={e => set('shippingName', e.target.value)} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>{t('indirizzoSpedizione')}</label>
              <input required style={inputStyle} value={form.shippingAddress1}
                onChange={e => set('shippingAddress1', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('citta')}</label>
              <input required style={inputStyle} value={form.shippingCity}
                onChange={e => set('shippingCity', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>{t('cap')}</label>
              <input required style={inputStyle} value={form.shippingPostalCode}
                onChange={e => set('shippingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* PAGAMENTO */}
        <section>
          <h2 style={sectionHeadStyle}>{t('pagamento')}</h2>
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
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: '0.25rem' }}>{t('bonifico')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>{t('bonificoDesc')}</p>
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
                <p style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--foreground)', marginBottom: '0.25rem' }}>{t('carta')}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                  {t('cartaDesc', { price: formatPrice(stripeTotal) })}
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* NOTE */}
        <div>
          <label style={labelStyle}>{t('note')}</label>
          <textarea
            style={{ ...inputStyle, resize: 'vertical' }}
            rows={3}
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder={t('notePlaceholder')}
          />
        </div>

        {/* RIEPILOGO + SUBMIT */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)', marginBottom: '0.5rem' }}>
            <span>{t('subtotale')}</span>
            <span style={{ color: 'var(--foreground)' }}>{formatPrice(cartTotal)}</span>
          </div>
          {shipping.mode === 'quote' ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1rem', lineHeight: 1.5 }}>
              {t('costoSpedizione')}: {t('spedizioneQuotata')}
            </p>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)', marginBottom: '1rem' }}>
              <span>{t('costoSpedizione')}</span>
              <span style={{ color: 'var(--foreground)' }}>
                {shipping.cost === 0 ? t('spedizioneGratis') : formatPrice(shipping.cost)}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--muted-fg)' }}>{t('totale')}</span>
            <span style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.5rem', color: 'var(--foreground)' }}>
              {formatPrice(displayTotal)}
            </span>
          </div>
        </div>

        {checkoutErrorKey && (
          <p
            role="alert"
            style={{
              background: 'rgba(224,133,133,0.1)',
              border: '1px solid rgba(224,133,133,0.4)',
              borderRadius: '0.625rem',
              color: '#e08585',
              fontSize: '0.875rem',
              lineHeight: 1.5,
              padding: '0.875rem 1rem',
              margin: 0,
            }}
          >
            {t(checkoutErrorKey)}
          </p>
        )}

        {reviewLoading && (
          <p style={{ fontSize: '0.875rem', color: 'var(--muted-fg)', margin: 0 }}>
            {t('caricamentoPrezzi')}
          </p>
        )}

        {priceReview && (
          <section
            style={{
              background: 'var(--card)',
              border: '1px solid rgba(200,169,126,0.4)',
              borderRadius: '1rem',
              padding: '1.25rem',
            }}
          >
            <h2 style={{ ...sectionHeadStyle, marginBottom: '0.75rem' }}>
              {t('revisionePrezziTitolo')}
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', lineHeight: 1.5, marginBottom: '1rem' }}>
              {t('revisionePrezziDescrizione')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {priceReview.diff.rows.map(row => (
                <div
                  key={row.variantSku}
                  style={{
                    borderTop: '1px solid var(--border)',
                    paddingTop: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                >
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    {row.variantSku}
                  </span>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
                      gap: '0.25rem 1rem',
                      fontSize: '0.8rem',
                      color: 'var(--muted-fg)',
                    }}
                  >
                    <span>{t('prezzoAttuale')}: {formatPrice(row.oldUnitPrice)}</span>
                    <span>
                      {t('prezzoNuovo')}: {row.newUnitPrice === null
                        ? t('prodottoNonDisponibile')
                        : formatPrice(row.newUnitPrice)}
                    </span>
                    <span>{t('quantita')}: {row.qty}</span>
                    <span>{t('nuovoTotaleRiga')}: {formatPrice(row.newLineTotalCents / 100)}</span>
                    {!row.available && (
                      <span style={{ color: '#e08585' }}>{t('prodottoNonDisponibile')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', marginTop: '1rem', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)' }}>
                <span>{t('nuovoSubtotale')}</span>
                <span style={{ color: 'var(--foreground)' }}>
                  {formatPrice(priceReview.diff.newProductsTotalCents / 100)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: 'var(--muted-fg)' }}>
                <span>{t('differenza')}</span>
                <span style={{ color: 'var(--foreground)' }}>
                  {formatPrice(priceReview.diff.deltaCents / 100)}
                </span>
              </div>
            </div>

            {reviewHasUnavailable && (
              <p style={{ fontSize: '0.8rem', color: '#e08585', lineHeight: 1.5, margin: '0.75rem 0 0' }}>
                {t('errorProdottoNonDisponibile')}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={applyReview}
                disabled={reviewHasUnavailable}
                style={{
                  background: reviewHasUnavailable ? 'rgba(200,169,126,0.3)' : 'var(--accent)',
                  color: '#080808',
                  border: 'none',
                  borderRadius: '0.625rem',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: reviewHasUnavailable ? 'not-allowed' : 'pointer',
                }}
              >
                {t('aggiornaCarrello')}
              </button>
              <button
                type="button"
                onClick={cancelReview}
                style={{
                  background: 'transparent',
                  color: 'var(--foreground)',
                  border: '1px solid var(--border)',
                  borderRadius: '0.625rem',
                  padding: '0.75rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {t('annulla')}
              </button>
            </div>
          </section>
        )}

        <button
          type="submit"
          disabled={orderBlocked}
          style={{
            background: orderBlocked ? 'rgba(200,169,126,0.3)' : 'var(--accent)',
            color: '#080808',
            border: 'none',
            borderRadius: '0.625rem',
            padding: '0.875rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: orderBlocked ? 'not-allowed' : 'pointer',
            width: '100%',
            letterSpacing: '0.04em',
            transition: 'background var(--dur-fast)',
          }}
        >
          {loading ? t('elaborazione') : form.paymentMethod === 'bonifico'
            ? t('confermaBonifico')
            : t('pagaCarta')}
        </button>
      </form>
    </div>
  )
}
