'use client'
import { useState, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { ResellerProduct, ProductVariant } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'
import { useCart } from '@/lib/cart'

interface Props {
  product: ResellerProduct
  featured?: boolean
}

export function KitCard({ product, featured = false }: Props) {
  const t = useTranslations('KitCard')
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(
    product.variants?.[0] ?? null
  )
  const [added, setAdded] = useState(false)
  const { addItem } = useCart()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  function handleAdd() {
    if (!selectedVariant) return
    addItem({
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      variantSku: selectedVariant.sku,
      variantLabel: selectedVariant.label,
      unitPrice: selectedVariant.price,
      qty: 1,
      priceTiers: [],
    })
    setAdded(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setAdded(false), 2000)
  }

  const price = selectedVariant?.price ?? product.basePrice

  return (
    <div style={{
      background: featured ? 'var(--surface-3)' : 'var(--card)',
      border: `1px solid ${featured ? 'rgba(200,169,126,0.45)' : 'var(--border)'}`,
      borderRadius: '1.25rem',
      padding: '2rem 1.75rem',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
    }}>
      {featured && (
        <span style={{
          position: 'absolute',
          top: '-0.65rem',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--accent)',
          color: 'var(--background)',
          fontSize: '0.6rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          padding: '0.25rem 0.75rem',
          borderRadius: '99px',
          whiteSpace: 'nowrap',
        }}>
          {t('piuRichiesto')}
        </span>
      )}

      <p style={{
        fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.14em',
        color: 'var(--accent)', marginBottom: '0.5rem',
      }}>
        {t('kitRivenditori')}
      </p>

      <h3 style={{
        fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
        fontSize: '1.4rem', color: 'var(--foreground)', marginBottom: '0.75rem', lineHeight: 1.2,
      }}>
        {product.name}
      </h3>

      {(product.resellerDescription ?? product.uniqueNote) && (
        <p style={{
          fontSize: '0.8rem', color: 'var(--muted-fg)', lineHeight: 1.7,
          marginBottom: '1.5rem', flexGrow: 1,
        }}>
          {product.resellerDescription ?? product.uniqueNote}
        </p>
      )}

      <div style={{ marginBottom: '1.5rem' }}>
        <span style={{
          fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
          fontSize: '2.25rem', color: featured ? 'var(--accent)' : 'var(--foreground)',
        }}>
          {formatPrice(price)}
        </span>
      </div>

      {product.variants && product.variants.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1.25rem' }}>
          {product.variants.map(v => (
            <button
              key={v.sku}
              onClick={() => setSelectedVariant(v)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                border: `1px solid ${selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: '0.5rem',
                padding: '0.4rem 0.75rem',
                fontSize: '0.8rem',
                cursor: 'pointer',
                background: selectedVariant?.sku === v.sku ? 'rgba(200,169,126,0.08)' : 'transparent',
                color: selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--foreground)',
                transition: 'border-color var(--dur-fast), background var(--dur-fast)',
              }}
            >
              <span>{v.label}</span>
              <span style={{ fontWeight: 500 }}>{formatPrice(v.price)}</span>
            </button>
          ))}
        </div>
      )}

      <button
        onClick={handleAdd}
        style={{
          background: added ? 'rgba(200,169,126,0.12)' : featured ? 'var(--accent)' : 'transparent',
          color: added ? 'var(--accent)' : featured ? 'var(--background)' : 'var(--foreground)',
          border: `1px solid ${added ? 'var(--accent)' : featured ? 'transparent' : 'var(--border)'}`,
          borderRadius: '0.625rem',
          padding: '0.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: 'pointer',
          width: '100%',
          letterSpacing: '0.03em',
          transition: 'background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)',
          marginTop: 'auto',
        }}
      >
        {added ? t('aggiunto') : t('aggiungiCarrello')}
      </button>
    </div>
  )
}
