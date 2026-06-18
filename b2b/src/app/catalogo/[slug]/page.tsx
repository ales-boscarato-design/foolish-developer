'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ResellerProduct, ProductVariant } from '@/lib/cms'
import { calculateUnitPrice, calculateLineTotal, formatPrice } from '@/lib/pricing'
import { PriceTierTable } from '@/components/PriceTierTable'
import { useCart } from '@/lib/cart'

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [product, setProduct] = useState<ResellerProduct | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const { addItem } = useCart()
  const router = useRouter()

  useEffect(() => {
    params.then(p => setSlug(p.slug))
  }, [params])

  useEffect(() => {
    if (!slug) return
    fetch(`/api/catalog?slug=${slug}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        setProduct(data)
        setSelectedVariant(data.variants?.[0] ?? null)
      })
  }, [slug])

  if (notFound) return (
    <div>
      <button
        onClick={() => router.back()}
        style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
      >
        ← Torna al catalogo
      </button>
      <p style={{ color: 'var(--muted-fg)' }}>Prodotto non trovato.</p>
    </div>
  )
  if (!product) return <p style={{ color: 'var(--muted-fg)' }}>Caricamento...</p>

  const tiers = product.priceTiers ?? []
  const basePrice = selectedVariant?.price ?? product.basePrice
  const unitPrice = calculateUnitPrice(basePrice, qty, tiers)
  const lineTotal = calculateLineTotal(basePrice, qty, tiers)

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
    setTimeout(() => setAdded(false), 2000)
  }

  const image = product.images?.[0]

  return (
    <div style={{ maxWidth: '42rem' }}>
      <button
        onClick={() => router.back()}
        style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
      >
        ← Torna al catalogo
      </button>

      {image && (
        <div style={{ borderRadius: '1rem', overflow: 'hidden', marginBottom: '2rem', background: 'var(--surface-2)', aspectRatio: '16/9' }}>
          <img
            src={image.url}
            alt={image.alt ?? product.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
      )}

      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', color: 'var(--foreground)', marginBottom: '0.375rem' }}>
        {product.name}
      </h1>

      {product.variants && product.variants.length > 0 && (
        <div style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
          <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
            Formato
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
                  transition: 'border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast)',
                  background: selectedVariant?.sku === v.sku ? 'rgba(200,169,126,0.1)' : 'transparent',
                  color: selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--foreground)',
                  fontWeight: selectedVariant?.sku === v.sku ? 500 : 400,
                }}
              >
                {v.label} — {formatPrice(v.price)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginTop: '1.5rem' }}>
        <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)' }}>
          Quantità
        </p>
        <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
          <button
            onClick={() => setQty(q => Math.max(1, q - 1))}
            style={{ padding: '0.4rem 0.75rem', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground)', lineHeight: 1 }}
          >
            −
          </button>
          <span style={{ padding: '0 0.75rem', fontSize: '0.875rem', color: 'var(--foreground)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)' }}>
            {qty}
          </span>
          <button
            onClick={() => setQty(q => q + 1)}
            style={{ padding: '0.4rem 0.75rem', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground)', lineHeight: 1 }}
          >
            +
          </button>
        </div>
        <div style={{ fontSize: '0.875rem', color: 'var(--muted-fg)' }}>
          <span>Prezzo/pz: </span>
          <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{formatPrice(unitPrice)}</span>
          {unitPrice < basePrice && (
            <span style={{ color: 'var(--muted-fg)', textDecoration: 'line-through', marginLeft: '0.5rem', fontSize: '0.8rem' }}>
              {formatPrice(basePrice)}
            </span>
          )}
        </div>
      </div>

      <PriceTierTable tiers={tiers} basePrice={basePrice} currentQty={qty} />

      <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        <p style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.5rem', color: 'var(--foreground)' }}>
          {formatPrice(lineTotal)}
        </p>
        <button
          onClick={handleAdd}
          style={{
            background: added ? 'rgba(200,169,126,0.15)' : 'var(--accent)',
            color: added ? 'var(--accent)' : '#080808',
            border: added ? '1px solid var(--accent)' : '1px solid transparent',
            borderRadius: '0.625rem',
            padding: '0.65rem 1.75rem',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)',
            letterSpacing: '0.04em',
          }}
        >
          {added ? '✓ Aggiunto al carrello' : 'Aggiungi al carrello'}
        </button>
      </div>
    </div>
  )
}
