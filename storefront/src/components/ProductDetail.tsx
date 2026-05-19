'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ShoppingBag, Check } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { motion, type Variants } from 'framer-motion'
import type { Product, ProductVariant, ProductAttribute, ProductVariantCombination } from '@/lib/cms'
import { useCart } from '@/lib/cart'
import { RichText } from './RichText'

// ─── Animation variants ─────────────────────────────────────────────────────
const containerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: 'easeOut' } },
}

// ─── Skeleton shimmer ────────────────────────────────────────────────────────
function ImageSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-xl ${className}`}
      style={{ backgroundColor: 'var(--muted)' }}
    />
  )
}

// ─── Check if option is available ───────────────────────────────────────────
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

// ─── Attribute selector ─────────────────────────────────────────────────────
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
      <p className="text-sm font-medium mb-3" style={{ color: 'var(--muted-fg)' }}>{attribute.label}</p>
      <div className="flex flex-wrap gap-2">
        {attribute.options.map((opt) => {
          const available = isOptionAvailable(opt.value, attribute.name, selectedAttrs, validCombinations)
          const isSelected = selectedValue === opt.value
          return (
            <motion.button
              key={opt.value}
              onClick={() => available && onSelect(opt.value)}
              disabled={!available}
              whileHover={available ? { scale: 1.04 } : {}}
              whileTap={available ? { scale: 0.96 } : {}}
              className={`px-4 py-3 text-sm rounded-xl border transition-all min-h-[48px] min-w-[48px] ${
                isSelected
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-black font-semibold shadow-lg'
                  : !available
                  ? 'opacity-30 cursor-not-allowed border-[var(--border)]'
                  : 'border-[var(--border)] hover:border-[var(--accent)] hover:shadow-md'
              }`}
            >
              {opt.label}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────
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
  const [imageLoaded, setImageLoaded] = useState(false)
  const addToCart = useCart((s) => s.add)

  const handleVariantSelect = (v: ProductVariant) => {
    setSelectedVariant(v)
    setImageLoaded(false)
    const reset: Record<string, string> = {}
    for (const attr of product.attributes) {
      if (attr.options.length > 0) reset[attr.name] = attr.options[0].value
    }
    setSelectedAttrs(reset)
  }

  const handleAttrSelect = (attrName: string, value: string) => {
    setSelectedAttrs((prev) => ({ ...prev, [attrName]: value }))
    setImageLoaded(false)
  }

  const handleAdd = () => {
    if (selectedVariant.stockStatus === 'unavailable') return
    addToCart(product, selectedVariant, selectedAttrs)
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
  }

  const firstImage = product.images[activeImage]?.image

  return (
    <motion.div
      className="max-w-6xl mx-auto px-4 py-8"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Breadcrumb */}
      <motion.div variants={itemVariants} className="mb-8">
        <span className="text-xs uppercase tracking-widest" style={{ color: 'var(--muted-fg)' }}>
          {product.section === 'tattoo' ? t('sectionTattoo') : t('sectionPmu')}
        </span>
      </motion.div>

      {/* Main grid: image left, info right */}
      <div className="grid lg:grid-cols-[1fr_420px] gap-8 mb-12 items-start">

        {/* Immagine — fade-up + skeleton */}
        <motion.div variants={itemVariants} className="relative">
          <div
            className="aspect-square rounded-2xl overflow-hidden relative"
            style={{ backgroundColor: 'var(--muted)' }}
          >
            {!imageLoaded && <ImageSkeleton className="absolute inset-0" />}
            {firstImage?.url ? (
              <Image
                src={firstImage.url}
                alt={firstImage.alt || product.name}
                fill
                className={`object-cover transition-opacity duration-500 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                priority
                sizes="(max-width: 1024px) 100vw, 60vw"
                onLoad={() => setImageLoaded(true)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ color: 'var(--muted-fg)' }}>
                {t('noImage')}
              </div>
            )}
            {product.limitedStock && (
              <motion.span
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute top-4 left-4 text-white text-xs font-bold px-4 py-2 rounded-xl uppercase tracking-wide"
                style={{ backgroundColor: 'var(--limited)' }}
              >
                {t('limited')}
              </motion.span>
            )}
          </div>

          {/* Dots indicator — replaces thumbnails */}
          {product.images.length > 1 && (
            <div className="flex gap-3 mt-6 justify-center">
              {product.images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { setActiveImage(i); setImageLoaded(false) }}
                  className="w-3 h-3 rounded-full transition-all min-h-[12px] min-w-[12px]"
                  style={{
                    backgroundColor: i === activeImage ? 'var(--accent)' : 'var(--border)',
                    transform: i === activeImage ? 'scale(1.3)' : 'scale(1)',
                  }}
                  aria-label={`Immagine ${i + 1}`}
                />
              ))}
            </div>
          )}
        </motion.div>

        {/* Info prodotto — sticky right column */}
        <motion.div variants={itemVariants} className="lg:sticky lg:top-8 lg:self-start space-y-6">

          {/* Nome + short description */}
          <div>
            <h1 className="text-4xl lg:text-5xl font-bold leading-tight font-artisan" style={{ color: 'var(--foreground)' }}>
              {product.name}
            </h1>
            {product.shortDescription && (
              <p className="text-base mt-3" style={{ color: 'var(--muted-fg)' }}>{product.shortDescription}</p>
            )}
          </div>

          {/* Prezzo */}
          <div className="flex items-baseline gap-4">
            <motion.span
              className="text-4xl font-bold"
              style={{ color: 'var(--accent)' }}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.5 }}
            >
              {selectedVariant.price.toFixed(2)}€
            </motion.span>
            <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>{t('vatIncluded')}</span>
          </div>

          {/* Varianti — 48px touch targets */}
          <div>
            <p className="text-sm font-medium mb-3" style={{ color: 'var(--muted-fg)' }}>{t('variantLabel')}</p>
            <div className="flex flex-wrap gap-3">
              {product.variants.map((v, i) => (
                <motion.button
                  key={v.sku}
                  onClick={() => handleVariantSelect(v)}
                  disabled={v.stockStatus === 'unavailable'}
                  whileHover={v.stockStatus !== 'unavailable' ? { scale: 1.03 } : {}}
                  whileTap={v.stockStatus !== 'unavailable' ? { scale: 0.97 } : {}}
                  className={`px-5 py-3 text-sm rounded-xl border transition-all min-h-[48px] ${
                    selectedVariant.sku === v.sku
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-black font-semibold shadow-lg'
                      : v.stockStatus === 'unavailable'
                      ? 'opacity-30 cursor-not-allowed border-[var(--border)]'
                      : 'border-[var(--border)] hover:border-[var(--accent)] hover:shadow-md'
                  }`}
                >
                  {v.label}
                  {v.stockStatus === 'low' && (
                    <span className="ml-2 text-xs" style={{ color: 'var(--limited)' }}>•</span>
                  )}
                </motion.button>
              ))}
            </div>
          </div>

          {/* Attributi */}
          {product.attributes.length > 0 && (
            <div className="space-y-5">
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
            <motion.div
              variants={itemVariants}
              className="rounded-xl p-5 border-l-4"
              style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--accent)' }}
            >
              <p className="text-sm font-artisan text-lg" style={{ color: 'var(--foreground)' }}>{product.uniqueNote}</p>
            </motion.div>
          )}

          {/* CTA — always visible, prominent */}
          <div className="border-t pt-6" style={{ borderColor: 'var(--border)' }}>
            {selectedVariant.limitedQty && (
              <motion.p
                variants={itemVariants}
                className="text-sm mb-3 font-semibold"
                style={{ color: 'var(--limited)' }}
              >
                {t('lastItems', { qty: selectedVariant.limitedQty })}
              </motion.p>
            )}
            <motion.button
              onClick={handleAdd}
              disabled={selectedVariant.stockStatus === 'unavailable' || added}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full flex items-center justify-center gap-3 py-4 px-8 rounded-2xl font-bold text-base transition-all min-h-[56px] shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                backgroundColor: added ? '#2d5a27' : 'var(--accent)',
                color: 'black',
              }}
            >
              {added ? (
                <><Check size={22} /> {t('added')}</>
              ) : selectedVariant.stockStatus === 'unavailable' ? (
                t('unavailable')
              ) : (
                <><ShoppingBag size={22} /> {t('addToCart')}</>
              )}
            </motion.button>
          </div>
        </motion.div>
      </div>

      {/* Descrizione prodotto — full width section below */}
      {product.description && (
        <motion.div
          variants={itemVariants}
          className="border-t pt-10"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-5 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>Descrizione</h2>
          <div
            className="rounded-2xl p-6 lg:p-8"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}
          >
            <RichText content={product.description} />
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}