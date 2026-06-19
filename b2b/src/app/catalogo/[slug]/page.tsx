'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { ResellerProduct, ProductVariant } from '@/lib/cms'
import { calculateUnitPrice, calculateLineTotal, formatPrice } from '@/lib/pricing'
import { PriceTierTable } from '@/components/PriceTierTable'
import { useCart } from '@/lib/cart'

const DEFAULT_QTY_PRESETS = [50, 100, 200, 500]

function parseQtyPresets(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_QTY_PRESETS
  const parsed = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n >= 1)
  return parsed.length > 0 ? parsed : DEFAULT_QTY_PRESETS
}

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [product, setProduct] = useState<ResellerProduct | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [qty, setQty] = useState(DEFAULT_QTY_PRESETS[0])
  const [qtyInput, setQtyInput] = useState(String(DEFAULT_QTY_PRESETS[0]))
  const [added, setAdded] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const { addItem } = useCart()
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('ProductPage')
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    params.then(p => setSlug(p.slug))
  }, [params])

  useEffect(() => {
    if (!slug) return
    fetch(`/api/catalog?slug=${slug}&locale=${locale}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        setProduct(data)
        setSelectedVariant(data.variants?.[0] ?? null)
        const firstPreset = parseQtyPresets(data.resellerQtyPresets)[0]
        setQty(firstPreset)
        setQtyInput(String(firstPreset))
      })
      .catch(() => setNotFound(true))
  }, [slug, locale])

  useEffect(() => () => {
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current)
  }, [])

  function applyQty(value: number) {
    const clamped = Math.max(1, value)
    setQty(clamped)
    setQtyInput(String(clamped))
  }

  function handleQtyInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQtyInput(e.target.value)
    const n = parseInt(e.target.value, 10)
    if (!isNaN(n) && n >= 1) setQty(n)
  }

  function handleQtyInputBlur() {
    const n = parseInt(qtyInput, 10)
    const presets = parseQtyPresets(product?.resellerQtyPresets)
    applyQty(isNaN(n) ? presets[0] : n)
  }

  if (notFound) return (
    <div>
      <button
        onClick={() => router.back()}
        style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
      >
        {t('tornaCatalogo')}
      </button>
      <p style={{ color: 'var(--muted-fg)' }}>{t('prodottoNonTrovato')}</p>
    </div>
  )
  if (!product) return <p style={{ color: 'var(--muted-fg)' }}>{t('caricamento')}</p>

  const tiers = product.priceTiers ?? []
  const basePrice = selectedVariant?.price ?? product.basePrice
  const unitPrice = calculateUnitPrice(basePrice, qty, tiers)
  const lineTotal = calculateLineTotal(basePrice, qty, tiers)
  const image = product.images?.[0]

  function handleAdd() {
    if (!selectedVariant) return
    addItem({
      productId: product!.id,
      productSlug: product!.slug,
      productName: product!.name,
      variantSku: selectedVariant.sku,
      variantLabel: selectedVariant.label,
      unitPrice: selectedVariant.price,
      qty,
      priceTiers: tiers,
    })
    setAdded(true)
    if (addedTimerRef.current) clearTimeout(addedTimerRef.current)
    addedTimerRef.current = setTimeout(() => setAdded(false), 2000)
  }

  return (
    <div>
      <button
        onClick={() => router.back()}
        style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.75rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
      >
        {t('tornaCatalogo')}
      </button>

      {/* Layout a due colonne */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: '3rem', alignItems: 'start' }}>

        {/* ── IMMAGINE ── */}
        <div>
          {image ? (
            <div style={{
              borderRadius: '1rem', overflow: 'hidden',
              background: 'var(--surface-2)',
            }}>
              <img
                src={image.url}
                alt={image.alt ?? product.name}
                style={{ width: '100%', height: 'auto', display: 'block' }}
              />
            </div>
          ) : (
            <div style={{
              borderRadius: '1rem', background: 'var(--surface-3)',
              aspectRatio: '1 / 1',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>Nessuna immagine</span>
            </div>
          )}
        </div>

        {/* ── DETTAGLI ── */}
        <div>
          <h1 style={{
            fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
            fontSize: '2.25rem', color: 'var(--foreground)', marginBottom: '0.5rem', lineHeight: 1.1,
          }}>
            {product.name}
          </h1>

          {(product.resellerDescription || product.uniqueNote) && (
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-fg)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
              {product.resellerDescription ?? product.uniqueNote}
            </p>
          )}

          {/* Varianti */}
          {product.variants && product.variants.length > 0 && (
            <div style={{ marginBottom: '1.75rem' }}>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
                {t('variante')}
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {product.variants.map(v => (
                  <button
                    key={v.sku}
                    onClick={() => setSelectedVariant(v)}
                    style={{
                      border: `1px solid ${selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: '0.5rem',
                      padding: '0.4rem 0.9rem',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      background: selectedVariant?.sku === v.sku ? 'rgba(200,169,126,0.1)' : 'transparent',
                      color: selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--foreground)',
                      fontWeight: selectedVariant?.sku === v.sku ? 500 : 400,
                      transition: 'border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast)',
                    }}
                  >
                    {v.label} — {formatPrice(v.price)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selettore quantità */}
          <div style={{ marginBottom: '1.75rem' }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
              {t('quantita')}
            </p>

            {/* Preset buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {parseQtyPresets(product?.resellerQtyPresets).map(p => (
                <button
                  key={p}
                  onClick={() => applyQty(p)}
                  style={{
                    border: `1px solid ${qty === p ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '0.5rem',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    background: qty === p ? 'rgba(200,169,126,0.1)' : 'transparent',
                    color: qty === p ? 'var(--accent)' : 'var(--muted-fg)',
                    fontWeight: qty === p ? 500 : 400,
                    transition: 'border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast)',
                  }}
                >
                  {p} pz
                </button>
              ))}
            </div>

            {/* Input numerico libero */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="number"
                min={1}
                value={qtyInput}
                onChange={handleQtyInputChange}
                onBlur={handleQtyInputBlur}
                style={{
                  width: '6rem',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.875rem',
                  background: 'var(--surface-2)',
                  color: 'var(--foreground)',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                Prezzo/pz: <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{formatPrice(unitPrice)}</span>
                {unitPrice < basePrice && (
                  <span style={{ textDecoration: 'line-through', marginLeft: '0.5rem', opacity: 0.5, fontSize: '0.75rem' }}>
                    {formatPrice(basePrice)}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Tabella fasce prezzo */}
          <PriceTierTable tiers={tiers} basePrice={basePrice} currentQty={qty} />

          {/* CTA */}
          <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <p style={{
              fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
              fontSize: '1.75rem', color: 'var(--foreground)',
            }}>
              {formatPrice(lineTotal)}
            </p>
            <button
              onClick={handleAdd}
              style={{
                background: added ? 'rgba(200,169,126,0.15)' : 'var(--accent)',
                color: added ? 'var(--accent)' : 'var(--background)',
                border: added ? '1px solid var(--accent)' : '1px solid transparent',
                borderRadius: '0.625rem',
                padding: '0.75rem 2rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)',
                letterSpacing: '0.04em',
              }}
            >
              {added ? t('aggiunto') : t('aggiungiCarrello')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
