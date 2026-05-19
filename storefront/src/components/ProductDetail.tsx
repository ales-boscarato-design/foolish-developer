'use client'

import { useState, useEffect, useRef } from 'react'
import Image from 'next/image'
import { ShoppingBag, Check, Star, Shield, Truck, Sparkles, Info } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { motion, useScroll, useTransform, useSpring, AnimatePresence } from 'framer-motion'
import type { Product, ProductVariant, ProductAttribute, ProductVariantCombination } from '@/lib/cms'
import { useCart } from '@/lib/cart'
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
interface FeatureCardProps {
  icon: React.ReactNode
  title: string
  description: string
  delay?: number
}

function FeatureCard({ icon, title, description, delay = 0 }: FeatureCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className="rounded-2xl p-5 text-center transition-all hover:shadow-xl hover:shadow-[var(--accent)]/5"
      style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', borderWidth: '1px' }}
      whileHover={{ y: -4 }}
    >
      <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: 'var(--muted)' }}>
        {icon}
      </div>
      <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>{title}</h3>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{description}</p>
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
  const [activeImage, setActiveImage] = useState(0)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [showStickyBar, setShowStickyBar] = useState(false)
  const addToCart = useCart((s) => s.add)
  const itemCount = useCart((s) => s.itemCount())
  const addRef = useRef<HTMLDivElement>(null)

  // Scroll-driven parallax for image
  const { scrollYProgress } = useScroll()
  const imageScale = useTransform(scrollYProgress, [0, 0.3], [1, 1.04])
  const imageY = useTransform(scrollYProgress, [0, 0.3], [0, -20])

  // Sticky CTA bar on mobile
  const { scrollY } = useScroll()
  useEffect(() => {
    const unsubscribe = scrollY.on('change', (y) => {
      // Show sticky bar after scrolling past the add-to-cart button
      if (addRef.current) {
        const rect = addRef.current.getBoundingClientRect()
        setShowStickyBar(y > rect.top + rect.height)
      }
    })
    return unsubscribe
  }, [scrollY])

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
            </motion.div>

            {/* Dots indicator */}
            {product.images.length > 1 && (
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

        {/* Feature highlights — 4 cards */}
        <motion.section variants={itemVariants} className="mb-14">
          <h2 className="text-xl font-semibold mb-6 font-artisan text-2xl" style={{ color: 'var(--foreground)' }}>
            Perché sceglierlo
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <FeatureCard
              icon={<Sparkles size={20} style={{ color: 'var(--accent)' }} />}
              title="Fatto a mano"
              description="Ogni foglio è unico, prodotto artigianalmente in Italia"
              delay={0}
            />
            <FeatureCard
              icon={<Shield size={20} style={{ color: 'var(--accent)' }} />}
              title="Naturale al 100%"
              description="Silicone alimentare atossico, sicuro per la pelle"
              delay={0.08}
            />
            <FeatureCard
              icon={<Star size={20} style={{ color: 'var(--accent)' }} />}
              title="Texture realistica"
              description="Floccatura che replica fedelmente la pelle vera"
              delay={0.16}
            />
            <FeatureCard
              icon={<Truck size={20} style={{ color: 'var(--accent)' }} />}
              title="Spedizione rapida"
              description="Prepariamo e spediamo entro 48h dall'ordine"
              delay={0.24}
            />
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
            {[
              { step: '01', title: 'Prepara la pelle', desc: 'Pulisci e asciuga la superficie di lavoro. La pelle sintetica va fissata con nastro medico o pinzette.' },
              { step: '02', title: 'Tatua senza fretta', desc: "Usa aghi classici. La texture flockata trattiene l'inchiostro come una pelle vera — nessuna differenza nel gesto." },
              { step: '03', title: 'Conserva e riutilizza', desc: "Dopo l'uso, pulisci con alcol. I fogli possono essere usati più volte a seconda della tecnica." },
            ].map((item) => (
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
                <p className="text-sm leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{item.desc}</p>
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
              {[
                { label: 'Foglio sintetico', desc: `1x ${product.name} — dimensioni selezionate` },
                { label: 'Scheda tecnica', desc: 'Codice seriale, specifiche materiale, istruzioni utilizzo' },
                { label: 'Certificato', desc: 'Attestazione materiale atossico e origine italiana' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: 'var(--accent)' }}>
                    <Check size={12} color="black" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>{item.label}</span>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--muted-fg)' }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

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
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className="fixed bottom-0 inset-x-0 z-50 lg:hidden border-t px-4 py-4"
            style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}
          >
            <button
              onClick={handleAdd}
              disabled={selectedVariant.stockStatus === 'unavailable' || added}
              className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl font-bold text-base transition-all min-h-[56px] shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}