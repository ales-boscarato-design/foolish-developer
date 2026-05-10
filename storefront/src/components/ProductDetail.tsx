'use client'

import { useState, useMemo } from 'react'
import Image from 'next/image'
import { ShoppingBag, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Product, ProductVariant, ProductAttribute, ProductVariantCombination } from '@/lib/cms'
import { useCart } from '@/lib/cart'

function isOptionAvailable(
  optionValue: string,
  attributeName: string,
  selectedAttrs: Record<string, string>,
  validCombinations: ProductVariantCombination[]
): boolean {
  if (validCombinations.length === 0) return true

  return validCombinations.some((comb) => {
    const attrValue = comb[attributeName as keyof ProductVariantCombination]
    if (attrValue !== optionValue) return false

    for (const [otherAttr, otherVal] of Object.entries(selectedAttrs)) {
      if (otherAttr === attributeName) continue
      const combVal = comb[otherAttr as keyof ProductVariantCombination]
      if (combVal !== undefined && combVal !== otherVal) return false
    }
    return true
  })
}

export function ProductDetail({ product }: { product: Product }) {
  const t = useTranslations('product')
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant>(product.variants[0])
  const [selectedAttrs, setSelectedAttrs] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const attr of product.attributes) {
      if (attr.options.length > 0) init[attr.name] = attr.options[0].value
    }
    return init
  })
  const [added, setAdded] = useState(false)
  const [activeImage, setActiveImage] = useState(0)
  const addToCart = useCart((s) => s.add)

  const handleVariantSelect = (v: ProductVariant) => {
    setSelectedVariant(v)
    const reset: Record<string, string> = {}
    for (const attr of product.attributes) {
      if (attr.options.length > 0) reset[attr.name] = attr.options[0].value
    }
    setSelectedAttrs(reset)
  }

  const handleAttrSelect = (attrName: string, value: string) => {
    setSelectedAttrs((prev) => ({ ...prev, [attrName]: value }))
  }

  const handleAdd = () => {
    if (selectedVariant.stockStatus === 'unavailable') return
    addToCart(product, selectedVariant, selectedAttrs)
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

          {/* Nota artigianalita */}
          {product.uniqueNote && (
            <div className="rounded-lg p-4 mb-5 text-sm border-l-2" style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--accent)' }}>
              <p style={{ color: 'var(--foreground)' }}>{product.uniqueNote}</p>
            </div>
          )}

          {/* Selezione Variante (formato) */}
          <div className="mb-6">
            <p className="text-sm font-medium mb-3">
              {t('variantLabel')}: <span style={{ color: 'var(--accent)' }}>{selectedVariant.label}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.sku}
                  onClick={() => handleVariantSelect(v)}
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
                  <span className="text-xs ml-1 font-normal" style={{ color: 'var(--muted-fg)' }}>
                    {v.price.toFixed(2)}€
                  </span>
                  {v.stockStatus === 'low' && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--limited)' }}>•</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Selettore Attributi */}
          {product.attributes.length > 0 && (
            <div className="mb-6 space-y-4">
              {product.attributes.map((attr) => (
                <AttributeSelector
                  key={attr.name}
                  attribute={attr}
                  selectedValue={selectedAttrs[attr.name]}
                  validCombinations={selectedVariant.validCombinations}
                  selectedAttrs={selectedAttrs}
                  onSelect={(value) => handleAttrSelect(attr.name, value)}
                />
              ))}
            </div>
          )}

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

interface AttributeSelectorProps {
  attribute: ProductAttribute
  selectedValue: string
  validCombinations: ProductVariantCombination[]
  selectedAttrs: Record<string, string>
  onSelect: (value: string) => void
}

function AttributeSelector({ attribute, selectedValue, validCombinations, selectedAttrs, onSelect }: AttributeSelectorProps) {
  return (
    <div>
      <p className="text-sm font-medium mb-2">{attribute.label}</p>
      <div className="flex flex-wrap gap-2">
        {attribute.options.map((opt) => {
          const available = isOptionAvailable(opt.value, attribute.name, selectedAttrs, validCombinations)
          const isSelected = selectedValue === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => available && onSelect(opt.value)}
              disabled={!available}
              className={`px-3 py-1.5 text-sm rounded border transition-all ${
                isSelected
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-black'
                  : !available
                  ? 'opacity-30 cursor-not-allowed border-[var(--border)]'
                  : 'border-[var(--border)] hover:border-[var(--accent)]'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}