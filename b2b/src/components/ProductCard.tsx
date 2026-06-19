'use client'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ResellerProduct } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'

interface Props { product: ResellerProduct }

export function ProductCard({ product }: Props) {
  const t = useTranslations('ProductCard')
  const image = product.images?.[0]
  const maxDiscount = product.priceTiers?.length
    ? Math.max(...product.priceTiers.map(tier => tier.discountPercent))
    : 0

  return (
    <Link href={`/catalogo/${product.slug}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '1rem',
        overflow: 'hidden',
        transition: `border-color var(--dur-fast), background var(--dur-fast)`,
        cursor: 'pointer',
      }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(200,169,126,0.35)'
          ;(e.currentTarget as HTMLDivElement).style.background = 'var(--surface-3)'
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'
          ;(e.currentTarget as HTMLDivElement).style.background = 'var(--card)'
        }}
      >
        {image ? (
          <div style={{ aspectRatio: '1', overflow: 'hidden', background: 'var(--surface-2)' }}>
            <img
              src={image.url}
              alt={image.alt ?? product.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover', transition: `transform var(--dur-slow)` }}
            />
          </div>
        ) : (
          <div style={{ aspectRatio: '1', background: 'var(--surface-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>{t('nessunaImmagine')}</span>
          </div>
        )}
        <div style={{ padding: '1rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: 'var(--foreground)' }}>
            {product.name}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '0.625rem' }}>
            {t('da')} {formatPrice(product.variants?.[0]?.price ?? product.basePrice)}{t('alPezzo')}
          </p>
          {maxDiscount > 0 && (
            <span style={{
              display: 'inline-block',
              background: 'rgba(200,169,126,0.12)',
              color: 'var(--accent)',
              fontSize: '0.7rem',
              padding: '0.2rem 0.5rem',
              borderRadius: '0.375rem',
              fontWeight: 500,
              letterSpacing: '0.04em',
            }}>
              {t('finoA', { n: maxDiscount })}
            </span>
          )}
          <button
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              const subject = encodeURIComponent(`Preventivo — ${product.name}`)
              const body = encodeURIComponent(`Salve,\n\nSono un rivenditore autorizzato di The Foolish Butcher e vorrei richiedere un preventivo per:\n\nProdotto: ${product.name}\nQuantità richiesta: \nNote / personalizzazioni: \n\nGrazie`)
              window.location.href = `mailto:wholesale@thefoolishbutcher.com?subject=${subject}&body=${body}`
            }}
            style={{
              display: 'block',
              marginTop: '0.75rem',
              background: 'transparent',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '0.72rem',
              color: 'var(--muted-fg)',
              textDecoration: 'underline',
              textUnderlineOffset: '2px',
              letterSpacing: '0.02em',
              textAlign: 'left',
            }}
          >
            {t('preventivo')}
          </button>
        </div>
      </div>
    </Link>
  )
}
