'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { ShoppingBag, Check, Star, Shield, Truck, Sparkles, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { motion, useScroll, useTransform, useSpring, AnimatePresence } from 'framer-motion'
import type { Product, ProductVariant, ProductAttribute, ProductVariantCombination, FeatureHighlight, ProductComponent, ProductPack } from '@/lib/cms'
import { useCart } from '@/lib/cart'
import { track } from '@/lib/analytics'
import { RichText } from './RichText'

// ─── Animation variants ─────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.1 } },
}

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
}

// ─── Skeleton shimmer ────────────────────────────────────────────────────────
function ImageSkeleton() {
  return <div className="animate-pulse rounded-2xl absolute inset-0" style={{ backgroundColor: 'var(--muted)' }} />
}

// ─── Cart icon bounce ─────────────────────────────────────────────────────────
function CartIcon({ count }: { count: number }) {
  return (
    <motion.span
      key={count}
      initial={{ scale: 1 }}
      animate={count > 0 ? { scale: [1, 1.35, 0.9, 1.15, 1], rotate: [0, -8, 8, -5, 0] } : {}}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <ShoppingBag size={20} />
    </motion.span>
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

// ─── Feature highlight card ──────────────────────────────────────────────────
const ICON_MAP: Record<FeatureHighlight['icon'], React.ReactNode> = {
  sparkles: <Sparkles size={20} style={{ color: 'var(--accent)' }} />,
  shield: <Shield size={20} style={{ color: 'var(--accent)' }} />,
  star: <Star size={20} style={{ color: 'var(--accent)' }} />,
  truck: <Truck size={20} style={{ color: 'var(--accent)' }} />,
}

const DEFAULT_HIGHLIGHTS: FeatureHighlight[] = [
  { icon: 'sparkles', title: 'Fatto a mano', description: 'Ogni foglio è unico, prodotto artigianalmente in Italia' },
  { icon: 'shield', title: 'Atossico', description: 'Silicone sintetico, sicuro per la pelle' },
  { icon: 'star', title: 'Texture realistica', description: 'Floccatura che replica fedelmente la pelle vera' },
  { icon: 'truck', title: 'Spedizione rapida', description: 'Prepariamo e spediamo entro 48h dall ordine' },
]

const DEFAULT_USAGE_STEPS = [
  { step: '01', title: 'Prepara la pelle', description: 'Pulisci e asciuga la superficie di lavoro. Fissa con nastro medico o pinzette.' },
  { step: '02', title: 'Tatua senza fretta', description: 'Usa aghi classici. La texture flockata trattiene l inchiostro come una pelle vera.' },
  { step: '03', title: 'Conserva e riutilizza', description: 'Dopo l uso, pulisci con alcol. I fogli possono essere usati più volte.' },
]

const DEFAULT_WHATS_IN_THE_BOX = [
  { label: 'Foglio sintetico', description: '1x foglio nelle dimensioni selezionate' },
  { label: 'Scheda tecnica', description: 'Codice seriale, specifiche materiale, istruzioni utilizzo' },
  { label: 'Certificato', description: 'Attestazione materiale atossico e origine italiana' },
]

interface FeatureCardProps {
  highlight: FeatureHighlight
  delay?: number
}

function FeatureCard({ highlight, delay = 0 }: FeatureCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className="rounded-2xl p-5 text-center transition-all hover:shadow-xl hover:shadow-[var(--accent)]/5"
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}
      whileHover={{ y: -4 }}
    >
      <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'var(--muted)' }}>
        {ICON_MAP[highlight.icon]}
      </div>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>{highlight.title}</h3>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{highlight.description}</p>
    </motion.div>
  )
}

// ─── Component product card ──────────────────────────────────────────────────
function ComponentCard({ component }: { component: ProductComponent }) {
  const addToCart = useCart((s) => s.add)
  const [added, setAdded] = useState(false)
  const firstVariant = component.variants[0]
  const firstImage = component.images[0]?.image

  const handleAdd = () => {
    if (!firstVariant) return
    addToCart(component as unknown as Product, firstVariant, {})
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
  }

  return (
    <motion.div
      variants={itemVariants}
      className="rounded-2xl p-5 flex gap-4 items-center border"
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}
      whileHover={{ y: -2 }}
    >
      {/* Immagine */}
      <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 relative" style={{ backgroundColor: 'var(--muted)' }}>
        {firstImage?.url ? (
          <Image src={firstImage.url} alt={component.name} fill className="object-cover" sizes="64px" />
        ) : (
          <div className="w-full h-full" style={{ backgroundColor: 'var(--muted)' }} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate" style={{ color: 'var(--foreground)' }}>{component.name}</p>
        <p className="text-sm mt-0.5" style={{ color: 'var(--accent)' }}>
          {firstVariant ? `${firstVariant.price.toFixed(2)}€` : `${component.basePrice.toFixed(2)}€`}
        </p>
      </div>

      {/* CTA */}
      <motion.button
        onClick={handleAdd}
        disabled={!firstVariant || added}
        whileTap={{ scale: 0.95 }}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all min-h-[36px] disabled:opacity-50"
        style={{ backgroundColor: added ? '#2d5a27' : 'var(--accent)', color: 'black' }}
      >
        {added ? <Check size={14} /> : <ShoppingBag size={14} />}
        {added ? 'Aggiunto' : 'Aggiungi'}
      </motion.button>
    </motion.div>
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
  const [qty, setQty] = useState(1)
  const [activeImage, setActiveImage] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [showStickyBar, setShowStickyBar] = useState(false)
  const addToCart = useCart((s) => s.add)
  const addPackToCart = useCart((s) => s.addPack)
  const itemCount = useCart((s) => s.itemCount())
  const addRef = useRef<HTMLDivElement>(null)

  // Scroll-driven parallax for image
  const { scrollYProgress } = useScroll()
  const imageScale = useTransform(scrollYProgress, [0, 0.3], [1, 1.04])
  const imageY = useTransform(scrollYProgress, [0, 0.3], [0, -20])

  // Sticky CTA — appears exactly when the original button exits the viewport
  useEffect(() => {
    const el = addRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShowStickyBar(false)
        } else {
          // Show only when the button has scrolled above the viewport (not below it)
          setShowStickyBar(entry.boundingClientRect.top < 0)
        }
      },
      { threshold: 0 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const maxQty = selectedVariant.limitedQty ?? 99

  const handleVariantSelect = (v: ProductVariant) => {
    setSelectedVariant(v)
    setActiveImage(0)
    setImageLoaded(false)
    setQty(1)
    const reset: Record<string, string> = {}
    for (const attr of product.attributes) {
      if (attr.options.length > 0) reset[attr.name] = attr.options[0].value
    }
    setSelectedAttrs(reset)
    track('variant_selected', { product: product.slug, variant: v.label, sku: v.sku, price: v.price })
  }

  const handleAttrSelect = (attrName: string, value: string) => {
    setSelectedAttrs((prev) => ({ ...prev, [attrName]: value }))
    setImageLoaded(false)
  }

  const handleAdd = () => {
    if (selectedVariant.stockStatus === 'unavailable') return
    addToCart(product, selectedVariant, selectedAttrs, qty)
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
    track('add_to_cart', { product: product.slug, variant: selectedVariant.label, sku: selectedVariant.sku, qty, price: selectedVariant.price })
  }

  const handleAddPack = (pack: ProductPack) => {
    if (selectedVariant.stockStatus === 'unavailable') return
    addPackToCart(product, selectedVariant, pack, selectedAttrs)
    setAdded(true)
    setTimeout(() => setAdded(false), 1800)
    track('pack_added', { product: product.slug, variant: selectedVariant.label, pack: pack.name, qty: pack.quantity, discount: pack.discountPercent })
  }

  const displayImage = selectedVariant.image ?? product.images[activeImage]?.image

  return (
    <>
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
        <div className="grid lg:grid-cols-[1fr_420px] gap-8 mb-14 items-start">

          {/* Immagine — parallax + skeleton */}
          <motion.div variants={itemVariants} className="relative" style={{ y: imageY }}>
            <motion.div
              className="aspect-square rounded-2xl overflow-hidden relative"
              style={{ backgroundColor: 'var(--muted)', scale: imageScale }}
            >
              {!imageLoaded && <ImageSkeleton />}
              {displayImage?.url ? (
                <Image
                  src={displayImage.url}
                  alt={displayImage.alt || product.name}
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
            </motion.div>

            {/* Dots indicator — solo quando non c'è un'immagine specifica per la variante */}
            {!selectedVariant.image && product.images.length > 1 && (
              <div className="flex gap-3 mt-6 justify-center">
                {product.images.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => { setActiveImage(i); setImageLoaded(false) }}
                    className="rounded-full transition-all min-h-[12px] min-w-[12px]"
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

            {/* Descrizione variante selezionata */}
            <AnimatePresence mode="wait">
              {selectedVariant.description && (
                <motion.p
                  key={selectedVariant.sku}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm rounded-xl px-4 py-3 border-l-4"
                  style={{
                    color: 'var(--foreground)',
                    backgroundColor: 'var(--muted)',
                    borderColor: 'var(--accent)',
                  }}
                >
                  {selectedVariant.description}
                </motion.p>
              )}
            </AnimatePresence>

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

            {/* CTA — ref for sticky detection */}
            <div ref={addRef} className="border-t pt-6" style={{ borderColor: 'var(--border)' }}>
              {selectedVariant.limitedQty && (
                <motion.p
                  variants={itemVariants}
                  className="text-sm mb-3 font-semibold"
                  style={{ color: 'var(--limited)' }}
                >
                  {t('lastItems', { qty: selectedVariant.limitedQty })}
                </motion.p>
              )}

              {/* Quantity picker */}
              {selectedVariant.stockStatus !== 'unavailable' && (
                <motion.div variants={itemVariants} className="flex items-center gap-3 mb-4">
                  <span className="text-sm font-medium" style={{ color: 'var(--muted-foreground)' }}>
                    Quantità
                  </span>
                  <div
                    className="flex items-center rounded-xl border overflow-hidden"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
                  >
                    <button
                      type="button"
                      onClick={() => setQty(q => Math.max(1, q - 1))}
                      disabled={qty <= 1}
                      className="w-10 h-10 flex items-center justify-center text-xl font-bold transition-opacity disabled:opacity-25 hover:opacity-70"
                      style={{ color: 'var(--foreground)' }}
                    >
                      −
                    </button>
                    <span
                      className="w-9 text-center font-bold text-base select-none"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQty(q => Math.min(maxQty, q + 1))}
                      disabled={qty >= maxQty}
                      className="w-10 h-10 flex items-center justify-center text-xl font-bold transition-opacity disabled:opacity-25 hover:opacity-70"
                      style={{ color: 'var(--foreground)' }}
                    >
                      +
                    </button>
                  </div>
                  {maxQty < 10 && (
                    <span className="text-xs font-medium" style={{ color: 'var(--limited)' }}>
                      max {maxQty}
                    </span>
                  )}
                </motion.div>
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
                <AnimatePresence mode="wait">
                  {added ? (
                    <motion.span key="added" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex items-center gap-2">
                      <motion.div
                        initial={{ rotate: -20, scale: 0 }}
                        animate={{ rotate: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      >
                        <Check size={22} />
                      </motion.div>
                      {t('added')}
                    </motion.span>
                  ) : selectedVariant.stockStatus === 'unavailable' ? (
                    t('unavailable')
                  ) : (
                    <span key="add" className="flex items-center gap-2">
                      <CartIcon count={itemCount} />
                      {t('addToCart')}
                    </span>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </motion.div>
        </div>

        {/* Pack upsell — solo se il prodotto ha pack definiti */}
        {product.packs && product.packs.length > 0 && selectedVariant.stockStatus !== 'unavailable' && (
          <motion.section variants={itemVariants} className="mb-14">
            <h2 className="text-xl font-semibold mb-4 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
              Acquista di più, risparmia
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {product.packs.map((pack) => {
                const packTotal = selectedVariant.price * pack.quantity * (1 - pack.discountPercent / 100)
                const savings = selectedVariant.price * pack.quantity - packTotal
                return (
                  <button
                    key={pack.id}
                    type="button"
                    onClick={() => handleAddPack(pack)}
                    className="relative text-left rounded-2xl border-2 p-4 transition-all hover:scale-[1.02] active:scale-[0.98]"
                    style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--card)' }}
                  >
                    {pack.badgeText && (
                      <span
                        className="absolute -top-2.5 left-4 text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--accent)', color: 'black' }}
                      >
                        {pack.badgeText}
                      </span>
                    )}
                    <p className="font-bold text-base mb-1" style={{ color: 'var(--foreground)' }}>
                      × {pack.quantity} {pack.name}
                    </p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold" style={{ color: 'var(--accent)' }}>
                        {packTotal.toFixed(2)}€
                      </span>
                      <span className="text-sm line-through opacity-50" style={{ color: 'var(--foreground)' }}>
                        {(selectedVariant.price * pack.quantity).toFixed(2)}€
                      </span>
                    </div>
                    <p className="text-xs mt-1 font-medium" style={{ color: 'var(--accent)' }}>
                      Risparmia {savings.toFixed(2)}€ ({pack.discountPercent}% di sconto)
                    </p>
                  </button>
                )
              })}
            </div>
          </motion.section>
        )}

        {/* Feature highlights — 4 cards */}
        <motion.section variants={itemVariants} className="mb-14">
          <h2 className="text-xl font-semibold mb-6 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
            Perché sceglierlo
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {(product.featureHighlights?.length ? product.featureHighlights : DEFAULT_HIGHLIGHTS).map((highlight, i) => (
              <FeatureCard key={i} highlight={highlight} delay={i * 0.08} />
            ))}
          </div>
        </motion.section>

        {/* Uso del prodotto — 3 step */}
        <motion.section
          variants={itemVariants}
          className="mb-14"
          style={{ borderColor: 'var(--border)' }}
        >
          <h2 className="text-xl font-semibold mb-6 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
            Come si usa
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(product.usageSteps?.length ? product.usageSteps : DEFAULT_USAGE_STEPS).map((item) => (
              <motion.div
                key={item.step}
                variants={itemVariants}
                className="relative rounded-2xl p-6"
                style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}
                whileHover={{ y: -4, transition: { duration: 0.3 } }}
              >
                <span className="text-5xl font-bold font-artisan opacity-10 absolute top-4 right-5" style={{ color: 'var(--accent)' }}>
                  {item.step}
                </span>
                <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--foreground)' }}>{item.title}</h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{item.description}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Cosa c'è nella confezione */}
        <motion.section variants={itemVariants} className="mb-14">
          <h2 className="text-xl font-semibold mb-6 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
            Contenuto
          </h2>
          <div
            className="rounded-2xl p-6 lg:p-8"
            style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}
          >
            <div className="space-y-4">
              {(product.whatsInTheBox?.length ? product.whatsInTheBox : DEFAULT_WHATS_IN_THE_BOX).map((item, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'var(--accent)' }}>
                    <Check size={12} color="black" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{item.label}</span>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--muted-fg)' }}>{item.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        {/* Componenti acquistabili separatamente */}
        {product.components && product.components.length > 0 && (
          <motion.section variants={itemVariants} className="mb-14">
            <h2 className="text-xl font-semibold mb-2 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
              Acquista i componenti separatamente
            </h2>
            <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>
              Hai già qualcosa? Puoi acquistare solo i pezzi che ti mancano.
            </p>
            <div className="space-y-3">
              {product.components.map((component) => (
                <ComponentCard key={component.id} component={component} />
              ))}
            </div>
          </motion.section>
        )}

        {/* Descrizione prodotto — full width below */}
        {product.description && (
          <motion.div
            variants={itemVariants}
            className="border-t pt-10"
            style={{ borderColor: 'var(--border)' }}
          >
            <h2 className="text-xl font-semibold mb-5 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
              Descrizione
            </h2>
            <div
              className="rounded-2xl p-6 lg:p-8"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}
            >
              <RichText content={product.description} />
            </div>
          </motion.div>
        )}
      </motion.div>

      {/* Sticky CTA bar — mobile only, shows after scroll past main CTA */}
      <AnimatePresence>
        {showStickyBar && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t px-4 py-4"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-3">
              {selectedVariant.stockStatus !== 'unavailable' && (
                <div
                  className="flex items-center rounded-xl border shrink-0 overflow-hidden"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
                >
                  <button
                    type="button"
                    onClick={() => setQty(q => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    className="w-9 h-12 flex items-center justify-center text-lg font-bold disabled:opacity-25"
                    style={{ color: 'var(--foreground)' }}
                  >−</button>
                  <span className="w-7 text-center font-bold text-sm select-none" style={{ color: 'var(--foreground)' }}>{qty}</span>
                  <button
                    type="button"
                    onClick={() => setQty(q => Math.min(maxQty, q + 1))}
                    disabled={qty >= maxQty}
                    className="w-9 h-12 flex items-center justify-center text-lg font-bold disabled:opacity-25"
                    style={{ color: 'var(--foreground)' }}
                  >+</button>
                </div>
              )}
              <button
                onClick={handleAdd}
                disabled={selectedVariant.stockStatus === 'unavailable' || added}
                className="flex-1 flex items-center justify-center gap-3 py-4 px-6 rounded-2xl font-bold text-base transition-all min-h-[56px] shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}