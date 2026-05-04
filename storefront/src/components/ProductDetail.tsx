'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ShoppingBag, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Product, ProductVariant } from '@/lib/cms'
import { useCart } from '@/lib/cart'

export function ProductDetail({ product }: { product: Product }) {
  const t = useTranslations('product')
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant>(product.variants[0])
  const [added, setAdded] = useState(false)
  const [activeImage, setActiveImage] = useState(0)
  const addToCart = useCart((s) => s.add)

  const handleAdd = () => {
    if (selectedVariant.stockStatus === 'unavailable') return
    addToCart(product, selectedVariant)
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
  }

  const firstImage = product.images[activeImage]?.image

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <div className="grid md:grid-cols-2 gap-10">

        {/* Immagini */}
        <div>
          <div className="aspect-square rounded-lg overflow-hidden relative" style={{ backgroundColor: 'var(--muted)' }}>
            {firstImage?.url ? (
              <Image
                src={firstImage.url}
                alt={firstImage.alt || product.name}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--muted-fg)' }}>
                {t('noImage')}
              </div>
            )}
            {product.limitedStock && (
              <span className="absolute top-3 left-3 text-white text-xs font-bold px-2 py-1 rounded uppercase tracking-wide" style={{ backgroundColor: 'var(--limited)' }}>
                {t('limited')}
              </span>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-2 mt-3">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  className={`w-16 h-16 rounded overflow-hidden border-2 transition-colors ${i === activeImage ? 'border-[var(--accent)]' : 'border-[var(--border)]'}`}
                >
                  <div className="w-full h-full relative">
                    <Image src={img.image.url} alt="" fill className="object-cover" sizes="64px" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info prodotto */}
        <div className="flex flex-col">
          <div className="mb-1">
            <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--muted-fg)' }}>
              {product.section === 'tattoo' ? t('sectionTattoo') : t('sectionPmu')}
            </span>
          </div>
          <h1 className="text-3xl font-bold mb-3">{product.name}</h1>

          {product.shortDescription && (
            <p className="mb-4" style={{ color: 'var(--muted-fg)' }}>{product.shortDescription}</p>
          )}

          {/* Nota artigianalità */}
          {product.uniqueNote && (
            <div className="rounded-lg p-4 mb-5 text-sm border-l-2" style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--accent)' }}>
              <p style={{ color: 'var(--foreground)' }}>{product.uniqueNote}</p>
            </div>
          )}

          {/* Selezione variante */}
          <div className="mb-6">
            <p className="text-sm font-medium mb-3">
              {t('variantLabel')}: <span style={{ color: 'var(--accent)' }}>{selectedVariant.label}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.sku}
                  onClick={() => setSelectedVariant(v)}
                  disabled={v.stockStatus === 'unavailable'}
                  className={`px-3 py-2 text-sm rounded border transition-all ${
                    selectedVariant.sku === v.sku
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : v.stockStatus === 'unavailable'
                      ? 'opacity-30 cursor-not-allowed'
                      : 'border-[var(--border)] hover:border-[var(--accent)]'
                  }`}
                >
                  {v.label}
                  {v.dimensions && <span className="text-xs ml-1" style={{ color: 'var(--muted-fg)' }}>({v.dimensions})</span>}
                  {v.stockStatus === 'low' && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--limited)' }}>•</span>
                  )}
                </button>
              ))}
            </div>
            {selectedVariant.dimensions && (
              <p className="text-xs mt-2" style={{ color: 'var(--muted-fg)' }}>
                {selectedVariant.dimensions} · {t('thickness', { value: selectedVariant.thicknessMm ?? '' })}
              </p>
            )}
          </div>

          {/* Prezzo + CTA */}
          <div className="mt-auto">
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
                {selectedVariant.price.toFixed(2)}€
              </span>
              <span className="text-xs" style={{ color: 'var(--muted-fg)' }}>{t('vatIncluded')}</span>
            </div>

            {selectedVariant.limitedQty && (
              <p className="text-sm mb-3 font-medium" style={{ color: 'var(--limited)' }}>
                {t('lastItems', { qty: selectedVariant.limitedQty })}
              </p>
            )}

            <button
              onClick={handleAdd}
              disabled={selectedVariant.stockStatus === 'unavailable' || added}
              className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: added ? '#2d5a27' : 'var(--accent)',
                color: 'black',
              }}
            >
              {added ? (
                <><Check size={18} /> {t('added')}</>
              ) : selectedVariant.stockStatus === 'unavailable' ? (
                t('unavailable')
              ) : (
                <><ShoppingBag size={18} /> {t('addToCart')}</>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
