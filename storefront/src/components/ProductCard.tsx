'use client'

import Link from 'next/link'
import Image from 'next/image'
import type { Product } from '@/lib/cms'
import { cmsImageUrl } from '@/lib/cms'
import { TiltCard } from './TiltCard'

interface ProductCardProps {
  product: Product
  showLimitedBadge?: boolean
  className?: string
  formatLabel?: string  // es. "A4", "A5", "XXL" — opzionale, mostrato come label
}

export function ProductCard({ product, showLimitedBadge, className = '', formatLabel }: ProductCardProps) {
  const lowestPrice = Math.min(...product.variants.map((v) => v.price))
  const hasMultipleVariants = product.variants.length > 1
  const firstImage = product.images[0]?.image
  const allUnavailable = product.variants.every((v) => v.stockStatus === 'unavailable')
  const hasLowStock = product.variants.some((v) => v.stockStatus === 'low')

  return (
    <TiltCard className={`h-full ${className}`}>
      <Link
        href={`/prodotto/${product.slug}`}
        className="group block h-full rounded-xl overflow-hidden relative border transition-[border-color,background-color]"
        style={{
          backgroundColor: 'var(--surface-2)',
          borderColor: 'var(--border)',
          transitionDuration: 'var(--dur-fast)',
        }}
        onMouseEnter={(e) => {
          const el = e.currentTarget
          el.style.borderColor = 'rgba(200, 169, 126, 0.2)'
          el.style.backgroundColor = 'var(--surface-3)'
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget
          el.style.borderColor = 'var(--border)'
          el.style.backgroundColor = 'var(--surface-2)'
        }}
      >
        {/* Immagine */}
        <div className="aspect-square relative overflow-hidden" style={{ backgroundColor: 'var(--muted)' }}>
          {firstImage?.url ? (
            <Image
              src={cmsImageUrl(firstImage.url)}
              alt={firstImage.alt || product.name}
              fill
              className="object-cover transition-transform group-hover:scale-105"
              style={{ transitionDuration: 'var(--dur-slow)' }}
              sizes="(max-width: 768px) 50vw, 33vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted-fg)' }}>
              No foto
            </div>
          )}

          {/* Badge limited */}
          {(showLimitedBadge || product.limitedStock) && (
            <span className="limited-pulse absolute top-2 left-2 text-white text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide"
              style={{ backgroundColor: 'var(--limited)' }}>
              Limitato
            </span>
          )}

          {/* Badge esaurito */}
          {allUnavailable && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
              <span className="text-white text-sm font-medium">Non disponibile</span>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-4">
          {/* Label formato (opzionale) */}
          {formatLabel && (
            <p className="text-label mb-1" style={{ color: 'var(--muted-fg)' }}>{formatLabel}</p>
          )}

          <h3 className="font-medium text-sm group-hover:text-[var(--accent)] transition-colors"
            style={{ transitionDuration: 'var(--dur-fast)' }}>
            {product.name}
          </h3>

          {product.shortDescription && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--muted-fg)' }}>
              {product.shortDescription}
            </p>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-mono text-sm font-semibold" style={{ color: 'var(--accent)' }}>
              {hasMultipleVariants
                ? `Da €${lowestPrice.toFixed(2)}`
                : `€${lowestPrice.toFixed(2)}`}
            </span>
            {hasLowStock && !allUnavailable && (
              <span className="text-label px-1.5 py-0.5 rounded"
                style={{ color: 'var(--limited)', background: 'rgba(192,57,43,0.1)' }}>
                Ultimi
              </span>
            )}
          </div>
        </div>
      </Link>
    </TiltCard>
  )
}
