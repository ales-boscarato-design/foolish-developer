import Link from 'next/link'
import Image from 'next/image'
import type { Product } from '@/lib/cms'
import { TiltCard } from './TiltCard'

interface ProductCardProps {
  product: Product
  showLimitedBadge?: boolean
  className?: string
}

export function ProductCard({ product, showLimitedBadge, className = '' }: ProductCardProps) {
  const lowestPrice = Math.min(...product.variants.map((v) => v.price))
  const hasMultipleVariants = product.variants.length > 1
  const firstImage = product.images[0]?.image
  const allUnavailable = product.variants.every((v) => v.stockStatus === 'unavailable')

  return (
    <TiltCard className={`h-full ${className}`}>
    <Link
      href={`/prodotto/${product.slug}`}
      className="group block bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden hover:border-[var(--accent)] transition-all duration-200 h-full relative"
    >
      {/* Immagine */}
      <div className="aspect-square bg-[var(--muted)] relative overflow-hidden">
        {firstImage?.url ? (
          <Image
            src={firstImage.url}
            alt={firstImage.alt || product.name}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            sizes="(max-width: 768px) 50vw, 33vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[var(--muted-fg)] text-xs">
            No foto
          </div>
        )}

        {/* Badge limited */}
        {(showLimitedBadge || product.limitedStock) && (
          <span className="limited-pulse absolute top-2 left-2 bg-[var(--limited)] text-white text-xs font-bold px-2 py-0.5 rounded uppercase tracking-wide">
            Limitato
          </span>
        )}

        {/* Badge esaurito */}
        {allUnavailable && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white text-sm font-medium">Non disponibile</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <h3 className="font-medium text-sm group-hover:text-[var(--accent)] transition-colors">
          {product.name}
        </h3>
        {product.shortDescription && (
          <p className="text-xs text-[var(--muted-fg)] mt-1 line-clamp-2">{product.shortDescription}</p>
        )}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--accent)]">
            {hasMultipleVariants ? `Da ${lowestPrice.toFixed(2)}€` : `${lowestPrice.toFixed(2)}€`}
          </span>
          {product.variants.some((v) => v.stockStatus === 'low') && (
            <span className="text-xs text-[var(--limited)]">Ultimi pezzi</span>
          )}
        </div>
      </div>
    </Link>
    </TiltCard>
  )
}
