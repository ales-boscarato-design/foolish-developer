'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ShoppingBag, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { Product, ProductVariant, ProductAttribute, ProductVariantCombination } from '@/lib/cms'
import { useCart } from '@/lib/cart'
import { RichText } from './RichText'

function isOptionAvailable(
  optionValue: string,
  attributeName: string,
  selectedAttrs: Record<string, string>,
  validCombinations: ProductVariantCombination[]
): boolean {
  if (validCombinations.length === 0) return true
  const hasConstraints = validCombinations.some((comb) =>
    Object.values(comb).some((v) => v !== null && v !== undefined)
  )
  if (!hasConstraints) return true

  return validCombinations.some((comb) => {
    const attrValue = comb[attributeName as keyof ProductVariantCombination]
    if (attrValue === null || attrValue === undefined) return true
    if (attrValue !== optionValue) return false
    for (const [otherAttr, otherVal] of Object.entries(selectedAttrs)) {
      if (otherAttr === attributeName) continue
      const combVal = comb[otherAttr as keyof ProductVariantCombination]
      if (combVal === null || combVal === undefined) continue
      if (combVal !== otherVal) return false
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
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--muted-fg)' }}>
          {product.section === 'tattoo' ? t('sectionTattoo') : t('sectionPmu')}
        </span>
      </div>

      {/* Main grid: image left, info right */}
      <div className="grid lg:grid-cols-[1fr_400px] gap-8 mb-12">

        {/* Immagine */}
        <div className="relative">
          <div className="aspect-square rounded-xl overflow-hidden relative" style={{ backgroundColor: 'var(--muted)' }}>
            {firstImage?.url ? (
              <Image
                src={firstImage.url}
                alt={firstImage.alt || product.name}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 1024px) 100vw, 60vw"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm" style={{ color: 'var(--muted-fg)' }}>
                {t('noImage')}
              </div>
            )}
            {product.limitedStock && (
              <span className="absolute top-4 left-4 text-white text-xs font-bold px-3 py-1.5 rounded uppercase tracking-wide" style={{ backgroundColor: 'var(--limited)' }}>
                {t('limited')}
              </span>
            )}
          </div>
          {product.images.length > 1 && (
            <div className="flex gap-3 mt-4">
              {product.images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => setActiveImage(i)}
                  className={`w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${i === activeImage ? 'border-[var(--accent)] shadow-md' : 'border-[var(--border)] hover:border-[var(--accent)]'}`}
                >
                  <div className="w-full h-full relative">
                    <Image src={img.image.url} alt="" fill className="object-cover" sizes="64px" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Info prodotto - sticky right column */}
        <div className="lg:sticky lg:top-8 lg:self-start">

          {/* Nome + short description */}
          <div className="mb-6">
            <h1 className="text-3xl lg:text-4xl font-bold mb-3 leading-tight">{product.name}</h1>
            {product.shortDescription && (
              <p className="text-base" style={{ color: 'var(--muted-fg)' }}>{product.shortDescription}</p>
            )}
          </div>

          {/* Prezzo */}
          <div className="flex items-baseline gap-3 mb-6">
            <span className="text-3xl font-bold" style={{ color: 'var(--accent)' }}>
              {selectedVariant.price.toFixed(2)}€
            </span>
            <span className="text-xs" style={{ color: 'var(--muted-fg)' }}>{t('vatIncluded')}</span>
          </div>

          {/* Varianti */}
          <div className="mb-6">
            <p className="text-sm font-medium mb-3">{t('variantLabel')}</p>
            <div className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <button
                  key={v.sku}
                  onClick={() => handleVariantSelect(v)}
                  disabled={v.stockStatus === 'unavailable'}
                  className={`px-4 py-2.5 text-sm rounded-lg border transition-all ${
                    selectedVariant.sku === v.sku
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-black font-semibold'
                      : v.stockStatus === 'unavailable'
                      ? 'opacity-30 cursor-not-allowed border-[var(--border)]'
                      : 'border-[var(--border)] hover:border-[var(--accent)]'
                  }`}
                >
                  {v.label}
                  {v.stockStatus === 'low' && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--limited)' }}>•</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Attributi */}
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

          {/* Nota artigianalità */}
          {product.uniqueNote && (
            <div className="rounded-lg p-4 mb-6 text-sm border-l-2" style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--accent)' }}>
              <p style={{ color: 'var(--foreground)' }}>{product.uniqueNote}</p>
            </div>
          )}

          {/* CTA - always visible at bottom of sticky column */}
          <div className="border-t pt-6" style={{ borderColor: 'var(--border)' }}>
            {selectedVariant.limitedQty && (
              <p className="text-sm mb-3 font-medium" style={{ color: 'var(--limited)' }}>
                {t('lastItems', { qty: selectedVariant.limitedQty })}
              </p>
            )}
            <button
              onClick={handleAdd}
              disabled={selectedVariant.stockStatus === 'unavailable' || added}
              className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-lg font-semibold text-base transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: added ? '#2d5a27' : 'var(--accent)',
                color: 'black',
              }}
            >
              {added ? (
                <><Check size={20} /> {t('added')}</>
              ) : selectedVariant.stockStatus === 'unavailable' ? (
                t('unavailable')
              ) : (
                <><ShoppingBag size={20} /> {t('addToCart')}</>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Descrizione prodotto - full width section below */}
      {product.description && (
        <div className="border-t pt-8" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-semibold mb-4">Descrizione</h2>
          <div className="rounded-xl p-6" style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}>
            <RichText content={product.description} />
          </div>
        </div>
      )}
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
              className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
                isSelected
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-black font-medium'
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