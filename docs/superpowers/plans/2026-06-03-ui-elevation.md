# UI Elevation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare il frontend di The Foolish Butcher al livello "Elevation" — stessa identità dark luxury, eseguita con token di sistema coerenti e pattern 21st.dev su Home, Product page e Checkout.

**Architecture:** Design System First — Sprint 1 aggiunge token CSS e costanti TS, poi ogni sprint successivo consuma quel sistema. Zero dipendenze esterne nuove: tutto usa Framer Motion e Tailwind già presenti.

**Tech Stack:** Next.js 16, React 19, Tailwind CSS v4, Framer Motion 12, Lenis, TypeScript 5, CSS custom properties

---

## File Map

| File | Azione | Responsabilità |
|------|--------|---------------|
| `storefront/src/app/globals.css` | Modifica | Aggiunge token spacing, motion, surfaces, glow, `.text-label`, `.text-mono` |
| `storefront/src/lib/motion.ts` | Crea | Costanti TS `DURATION` e `EASE` per Framer Motion |
| `storefront/src/app/[locale]/page.tsx` | Modifica | Hero CTA upgrade, TrustBadge copy, sezioni stagger |
| `storefront/src/components/ProductCard.tsx` | Modifica | Hover glow, label formato, prezzo monospace |
| `storefront/src/components/BentoGrid.tsx` | Modifica | Consuma DURATION/EASE da motion.ts |
| `storefront/src/components/ProductDetail.tsx` | Modifica | Gallery thumbnails, crossfade, pills, pack, ATC, feature cards |
| `storefront/src/app/[locale]/checkout/page.tsx` | Modifica | Form fields, shipping bar, promo, summary, pay button, cart items |

---

## Task 1: Design System tokens — globals.css

**Files:**
- Modify: `storefront/src/app/globals.css`

- [ ] **Step 1: Aggiungi spacing scale, surface layers e glow tokens nel blocco `:root`**

Apri `storefront/src/app/globals.css`. Individua la chiusura del blocco `:root` (riga 13, dopo `--limited: #c0392b;`). Aggiungi subito prima della `}`:

```css
  /* ── Spacing scale (base 4px) ── */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-6:  24px;
  --space-8:  32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;
  --space-32: 128px;

  /* ── Surface layers (depth senza colore) ── */
  --surface-base: #080808;
  --surface-1:    #0a0a0a;
  --surface-2:    #0f0f0f;
  --surface-3:    #141414;
  --surface-4:    #1a1a1a;

  /* ── Accent glow (per focus ring e hover) ── */
  --glow-subtle: rgba(200, 169, 126, 0.06);
  --glow-medium: rgba(200, 169, 126, 0.12);
  --glow-strong: rgba(200, 169, 126, 0.20);

  /* ── Motion durations ── */
  --dur-instant:   80ms;
  --dur-fast:      150ms;
  --dur-normal:    250ms;
  --dur-slow:      450ms;
  --dur-cinematic: 750ms;

  /* ── Motion easings ── */
  --ease-out:        cubic-bezier(0, 0, 0.2, 1);
  --ease-spring:     cubic-bezier(0.16, 1, 0.3, 1);
  --ease-emphasized: cubic-bezier(0.4, 0, 0.6, 1);
```

- [ ] **Step 2: Aggiungi `.text-label` e `.text-mono` dopo `.font-artisan`**

Dopo il blocco `.font-artisan { ... }` (riga 65), aggiungi:

```css
/* Label uppercase — section tags, form labels, badge */
.text-label {
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  line-height: 1.4;
}

/* Mono — prezzi, seriali, codici promo */
.text-mono {
  font-family: ui-monospace, 'Courier New', monospace;
  letter-spacing: 0.04em;
}
```

- [ ] **Step 3: Verifica TypeScript e build**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore (globals.css non produce errori TS).

- [ ] **Step 4: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/app/globals.css && git commit -m "feat(design-system): add spacing, surface, glow, motion tokens + text-label/mono"
```

---

## Task 2: motion.ts — costanti Framer Motion

**Files:**
- Create: `storefront/src/lib/motion.ts`

- [ ] **Step 1: Crea il file**

```typescript
// storefront/src/lib/motion.ts
// Costanti condivise per Framer Motion — speculari ai CSS var in globals.css

export const DURATION = {
  instant:   0.08,
  fast:      0.15,
  normal:    0.25,
  slow:      0.45,
  cinematic: 0.75,
} as const

export const EASE = {
  out:        [0, 0, 0.2, 1] as const,
  spring:     [0.16, 1, 0.3, 1] as const,
  emphasized: [0.4, 0, 0.6, 1] as const,
} as const

// Variants riutilizzabili per stagger di sezione
export const sectionVariants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.08,
    },
  },
} as const

export const fadeUpItem = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.slow, ease: EASE.spring },
  },
} as const
```

- [ ] **Step 2: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/lib/motion.ts && git commit -m "feat(design-system): add motion constants (DURATION, EASE, shared variants)"
```

---

## Task 3: BentoGrid — consuma motion.ts

**Files:**
- Modify: `storefront/src/components/BentoGrid.tsx`

- [ ] **Step 1: Sostituisci valori inline con costanti da motion.ts**

Il file attuale usa `duration: 0.65` e `ease: [0.16, 1, 0.3, 1]` inline. Sostituisci l'intero file:

```typescript
'use client'

import { useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { DURATION, EASE } from '@/lib/motion'

interface BentoGridProps {
  children: React.ReactNode
  className?: string
}

export function BentoGrid({ children, className = '' }: BentoGridProps) {
  return (
    <div className={`grid gap-4 ${className}`}>
      {children}
    </div>
  )
}

interface BentoItemProps {
  children: React.ReactNode
  className?: string
  span?: 'col-1' | 'col-2' | 'row-2' | 'col-2-row-2'
  delay?: number
}

export function BentoItem({
  children,
  className = '',
  span,
  delay = 0,
}: BentoItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-10%' })
  const reduced = useReducedMotion()

  const spanClasses: Record<string, string> = {
    'col-1': '',
    'col-2': 'md:col-span-2',
    'row-2': 'md:row-span-2',
    'col-2-row-2': 'md:col-span-2 md:row-span-2',
  }

  if (reduced) {
    return (
      <div ref={ref} className={`${spanClasses[span ?? 'col-1']} ${className}`}>
        {children}
      </div>
    )
  }

  return (
    <motion.div
      ref={ref}
      className={`${spanClasses[span ?? 'col-1']} ${className}`}
      initial={{ opacity: 0, y: 28 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{
        duration: DURATION.slow,
        delay,
        ease: EASE.spring,
      }}
    >
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 2: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/components/BentoGrid.tsx && git commit -m "refactor(bento): use DURATION/EASE constants from motion.ts"
```

---

## Task 4: ProductCard — hover glow, label formato, prezzo monospace

**Files:**
- Modify: `storefront/src/components/ProductCard.tsx`

- [ ] **Step 1: Sostituisci l'intero file**

```typescript
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
              className="object-cover transition-transform"
              style={{ transitionDuration: 'var(--dur-slow)' }}
              sizes="(max-width: 768px) 50vw, 33vw"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted-fg)' }}>
              No foto
            </div>
          )}

          {/* Scale on hover via CSS group */}
          <style>{`.group:hover img { transform: scale(1.04); }`}</style>

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

          <h3 className="font-medium text-sm transition-colors" style={{ transitionDuration: 'var(--dur-fast)' }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--accent)' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '' }}>
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
```

> **Nota:** Il `onMouseEnter`/`onMouseLeave` sul `<h3>` è un workaround per evitare l'introduzione di `'use client'` nel componente. Se preferisci un approccio più pulito, aggiungi `group-hover:text-[var(--accent)]` con Tailwind e rimuovi gli handler inline.

- [ ] **Step 2: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 3: Verifica visiva**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npm run dev
```

Apri `http://localhost:3000/it` e verifica:
- Le card prodotto hanno hover con border accent e background leggermente più chiaro
- Il prezzo è in font monospace con `€` prima del numero e due decimali
- Le card "Ultimi pezzi" mostrano un badge rosso pill invece del testo libero

- [ ] **Step 4: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/components/ProductCard.tsx && git commit -m "feat(product-card): hover glow, price monospace, ultimi pill badge"
```

---

## Task 5: Home page — Hero CTA + ghost button + TrustBadge

**Files:**
- Modify: `storefront/src/app/[locale]/page.tsx`

- [ ] **Step 1: Upgrade CTA primario (gradient overlay + border radius)**

In `page.tsx`, individua il `<Link href="/tattoo" ...>` (riga ~236). Sostituisci quel singolo Link:

```tsx
<Link
  href="/tattoo"
  className="relative overflow-hidden px-8 py-4 font-semibold text-sm tracking-widest uppercase transition-all active:scale-[0.98]"
  style={{ backgroundColor: 'var(--accent)', color: '#080808' }}
>
  <span
    className="absolute inset-0 pointer-events-none"
    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, transparent 55%)' }}
    aria-hidden
  />
  {t('hero.ctaShop')}
</Link>
```

- [ ] **Step 2: Upgrade CTA ghost (border accent, colore accent)**

Individua il `<Link href="/pmu" ...>` (riga ~244). Sostituisci:

```tsx
<Link
  href="/pmu"
  className="px-8 py-4 font-semibold text-sm tracking-widest uppercase border transition-colors"
  style={{
    borderColor: 'rgba(200, 169, 126, 0.25)',
    color: 'var(--accent)',
    transitionDuration: 'var(--dur-fast)',
  }}
>
  {t('hero.ctaPmu')}
</Link>
```

- [ ] **Step 3: Upgrade TrustBadge component (copy specifico + hover border)**

Individua la funzione `TrustBadge` (riga ~76). Sostituisci la funzione:

```tsx
function TrustBadge({
  Icon,
  title,
  body,
}: {
  Icon: React.ElementType
  title: string
  body: string
}) {
  return (
    <div
      className="px-7 py-8 flex gap-4 items-start border-r last:border-r-0 transition-colors"
      style={{
        borderColor: 'var(--border)',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,126,0.15)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
    >
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
      <div>
        <p className="text-label mb-1" style={{ color: 'var(--foreground)' }}>{title}</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{body}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Aggiorna il copy dei TrustBadge (più specifici)**

Individua le 4 chiamate a `<TrustBadge ...>` nella sezione trust (cerca `Truck` nel file). Sostituisci con copy più specifici:

```tsx
<TrustBadge Icon={ShieldCheck} title="Stripe · Pagamento sicuro" body="Dati crittografati, nessuna info salvata" />
<TrustBadge Icon={Package}     title="Spedizione in 24–48h"      body="Prepariamo e spediamo il giorno lavorativo successivo" />
<TrustBadge Icon={MessageSquare} title="Supporto diretto"        body="Risponde Alessandro — non un bot" />
<TrustBadge Icon={Truck}       title="Gratis sopra €60"          body="Spedizione gratuita per ordini qualificati" />
```

- [ ] **Step 5: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 6: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/app/[locale]/page.tsx && git commit -m "feat(home): hero CTA gradient overlay, ghost button accent, trust badge copy upgrade"
```

---

## Task 6: ProductDetail — gallery thumbnail strip + crossfade

**Files:**
- Modify: `storefront/src/components/ProductDetail.tsx`

- [ ] **Step 1: Import DURATION/EASE**

All'inizio del file, aggiungi l'import dopo le importazioni esistenti da `framer-motion`:

```typescript
import { DURATION, EASE } from '@/lib/motion'
```

- [ ] **Step 2: Sostituisci i dot indicator con thumbnail strip**

Individua il blocco `{effectiveGallery.length > 1 && (` con i dot (riga ~377). Sostituisci l'intero blocco (dai `{effectiveGallery.length > 1 && (` fino alla `</div>` di chiusura inclusiva):

```tsx
{effectiveGallery.length > 1 && (
  <div className="flex gap-2 mt-3 flex-wrap">
    {effectiveGallery.slice(0, 4).map((img, i) => (
      <button
        key={i}
        onClick={() => { setActiveImage(i); }}
        aria-label={`Immagine ${i + 1}`}
        className="relative flex-shrink-0 rounded-lg overflow-hidden border transition-[border-color,box-shadow]"
        style={{
          width: 44,
          height: 44,
          borderColor: i === activeImage ? 'var(--accent)' : 'var(--border)',
          boxShadow: i === activeImage ? '0 0 0 1px rgba(200,169,126,0.3)' : 'none',
          transitionDuration: 'var(--dur-fast)',
          backgroundColor: 'var(--muted)',
        }}
      >
        {img?.url && (
          <Image
            src={cmsImageUrl(img.url)}
            alt=""
            fill
            className="object-cover"
            sizes="44px"
          />
        )}
      </button>
    ))}
    {effectiveGallery.length > 4 && (
      <div
        className="flex-shrink-0 rounded-lg border flex items-center justify-center text-xs"
        style={{ width: 44, height: 44, borderColor: 'var(--border)', color: 'var(--muted-fg)' }}
      >
        +{effectiveGallery.length - 4}
      </div>
    )}
  </div>
)}
```

> **Nota:** Rimuovi anche `setImageLoaded(false)` dal click del thumbnail se presente — il crossfade nel prossimo step lo gestisce.

- [ ] **Step 3: Applica AnimatePresence crossfade sull'immagine principale**

Individua il blocco dell'immagine principale (intorno a riga 349, dentro `<motion.div className="aspect-square rounded-2xl overflow-hidden relative" ...>`). L'immagine attuale è un singolo `<Image>` con `imageLoaded` per l'opacity. Sostituisci tutto il contenuto interno del `<motion.div>` (mantieni il `<motion.div>` esterno con parallax invariato):

```tsx
{/* Skeleton visibile solo al primo caricamento */}
{!imageLoaded && <ImageSkeleton />}

{/* Crossfade animato al cambio di activeImage */}
<AnimatePresence mode="sync">
  {displayImage?.url ? (
    <motion.div
      key={`${displayImage.url}-${activeImage}`}
      className="absolute inset-0"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.fast, ease: EASE.out }}
    >
      <Image
        src={cmsImageUrl(displayImage.url)}
        alt={displayImage.alt || product.name}
        fill
        className="object-cover"
        priority
        sizes="(max-width: 1024px) 100vw, 60vw"
        onLoad={() => setImageLoaded(true)}
      />
    </motion.div>
  ) : (
    <motion.div
      key="no-image"
      className="absolute inset-0 flex items-center justify-center"
      style={{ color: 'var(--muted-fg)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {t('noImage')}
    </motion.div>
  )}
</AnimatePresence>
```

- [ ] **Step 4: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 5: Verifica visiva**

Avvia `npm run dev`, vai su una pagina prodotto con più immagini. Clicca le thumbnail: l'immagine deve fare crossfade (dissolvenza) senza flash nero. Le thumbnail devono avere border accent sull'attiva.

- [ ] **Step 6: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/components/ProductDetail.tsx && git commit -m "feat(product): gallery thumbnail strip + AnimatePresence crossfade"
```

---

## Task 7: ProductDetail — variant pills glass effect + stock badge

**Files:**
- Modify: `storefront/src/components/ProductDetail.tsx`

- [ ] **Step 1: Sostituisci classi variant pill nell'`AttributeSelector`**

Individua la funzione `AttributeSelector` (riga ~80). Sostituisci le classi nel `<motion.button>`:

```tsx
className={[
  'relative px-4 py-2.5 text-sm rounded-lg border transition-[border-color,background-color,color,box-shadow] min-h-[44px] min-w-[44px]',
  isSelected
    ? 'font-medium'
    : !available
    ? 'opacity-20 cursor-not-allowed line-through'
    : 'hover:text-[var(--accent)]',
].join(' ')}
style={
  isSelected
    ? {
        borderColor: 'rgba(200, 169, 126, 0.5)',
        backgroundColor: 'rgba(200, 169, 126, 0.10)',
        color: 'var(--accent)',
        boxShadow: '0 0 0 1px rgba(200,169,126,0.15), 0 4px 12px rgba(200,169,126,0.06)',
        transitionDuration: 'var(--dur-fast)',
      }
    : !available
    ? { borderColor: 'var(--border)', transitionDuration: 'var(--dur-fast)' }
    : { borderColor: 'var(--border)', transitionDuration: 'var(--dur-fast)' }
}
```

Aggiungi il checkmark badge sulla pill selezionata subito prima di `{opt.label}`:

```tsx
{isSelected && (
  <span
    className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold pointer-events-none"
    style={{ backgroundColor: 'var(--accent)', color: '#080808' }}
    aria-hidden
  >
    ✓
  </span>
)}
{opt.label}
```

- [ ] **Step 2: Aggiungi badge "Ultimi" inline nelle varianti principali (selector varianti)**

Individua il loop `{product.variants.map((v, i) => (` (riga ~426). Nella classe del `<motion.button>`, applica lo stesso pattern glass effect. Dentro il bottone, sostituisci il puntino `{v.stockStatus === 'low' && <span ...>•</span>}` con:

```tsx
{v.stockStatus === 'low' && (
  <span
    className="ml-2 text-label px-1 py-0.5 rounded"
    style={{ color: 'var(--limited)', background: 'rgba(192,57,43,0.1)' }}
  >
    Ultimi
  </span>
)}
```

- [ ] **Step 3: Aggiungi stock badge esplicita sotto il prezzo**

Individua il blocco del prezzo (`{/* Prezzo */}`, riga ~409). Dopo il `<motion.span>` del prezzo e l'`<span>` "IVA inclusa", aggiungi:

```tsx
<div className="mt-2">
  {selectedVariant.stockStatus === 'available' && (
    <span
      className="inline-flex items-center gap-1.5 text-label px-2 py-1 rounded border"
      style={{
        color: '#5a9c52',
        background: 'rgba(45,90,39,0.15)',
        borderColor: 'rgba(90,156,82,0.2)',
      }}
    >
      ● Disponibile
    </span>
  )}
  {selectedVariant.stockStatus === 'low' && (
    <span
      className="inline-flex items-center gap-1.5 text-label px-2 py-1 rounded border"
      style={{
        color: 'var(--limited)',
        background: 'rgba(192,57,43,0.10)',
        borderColor: 'rgba(192,57,43,0.20)',
      }}
    >
      ● Ultimi pezzi
    </span>
  )}
</div>
```

- [ ] **Step 4: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/components/ProductDetail.tsx && git commit -m "feat(product): variant pills glass effect, checkmark badge, stock pill explicit"
```

---

## Task 8: ProductDetail — pack selector + ATC button + feature cards

**Files:**
- Modify: `storefront/src/components/ProductDetail.tsx`

- [ ] **Step 1: Upgrade pack selector**

Cerca il blocco dei pack nel render principale — la sezione con `product.packs?.map(...)` o simile struttura. Ogni pack card attualmente mostra nome, percentuale sconto e prezzo. Individua il componente/JSX del singolo pack e sostituisci il contenuto interno con:

```tsx
{/* Layout: info a sinistra, pricing a destra */}
<div className="flex items-center justify-between w-full">
  <div className="flex flex-col gap-1">
    <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
      {pack.name}
    </span>
    {pack.discountPercent > 0 && (
      <span
        className="text-label px-1.5 py-0.5 rounded border w-fit"
        style={{
          color: '#2d8c27',
          background: 'rgba(45,140,39,0.10)',
          borderColor: 'rgba(45,140,39,0.20)',
        }}
      >
        Risparmi €{((selectedVariant.price * pack.quantity) * (pack.discountPercent / 100)).toFixed(2)}
      </span>
    )}
  </div>
  <div className="text-right flex flex-col">
    {pack.discountPercent > 0 && (
      <span className="text-xs line-through" style={{ color: 'var(--muted-fg)' }}>
        €{(selectedVariant.price * pack.quantity).toFixed(2)}
      </span>
    )}
    <span className="text-mono font-semibold text-base" style={{ color: 'var(--accent)' }}>
      €{(selectedVariant.price * pack.quantity * (1 - pack.discountPercent / 100)).toFixed(2)}
    </span>
  </div>
</div>
```

Aggiungi hover state alla card pack (trova il `className` del wrapper pack):

```
transition-[border-color,background-color]
```

Con inline style per transitionDuration e hover gestito via `onMouseEnter`/`onMouseLeave`:

```tsx
onMouseEnter={(e) => {
  const el = e.currentTarget as HTMLElement
  el.style.borderColor = 'rgba(200,169,126,0.2)'
  el.style.backgroundColor = 'var(--glow-subtle)'
}}
onMouseLeave={(e) => {
  const el = e.currentTarget as HTMLElement
  el.style.borderColor = 'var(--border)'
  el.style.backgroundColor = ''
}}
```

- [ ] **Step 2: Upgrade Add to Cart button**

Individua il `<motion.button>` del CTA principale (riga ~540, dentro `<div ref={addRef} ...>`). Sostituisci il button:

```tsx
<motion.button
  onClick={handleAdd}
  disabled={selectedVariant.stockStatus === 'unavailable' || added}
  whileTap={selectedVariant.stockStatus !== 'unavailable' ? { scale: 0.98 } : {}}
  className="relative w-full overflow-hidden flex items-center justify-center gap-2 rounded-lg font-semibold text-label transition-colors"
  style={{
    height: 52,
    backgroundColor: added ? '#2d5a27' : 'var(--accent)',
    color: added ? '#7dc972' : '#080808',
    border: added ? '1px solid rgba(125,201,114,0.2)' : 'none',
    transitionDuration: 'var(--dur-normal)',
  }}
>
  {/* Gradient overlay */}
  {!added && (
    <span
      className="absolute inset-0 pointer-events-none"
      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, transparent 55%)' }}
      aria-hidden
    />
  )}
  <CartIcon count={itemCount} />
  {added ? 'Aggiunto al carrello' : t('addToCart')}
</motion.button>
```

- [ ] **Step 3: Upgrade feature cards — 2×2 layout left-aligned**

Individua la funzione `FeatureCard` (riga ~144). Sostituiscila:

```tsx
function FeatureCard({ highlight }: FeatureCardProps) {
  return (
    <motion.div
      variants={itemVariants}
      className="flex gap-3 items-start rounded-xl p-4 border transition-[border-color]"
      style={{
        backgroundColor: 'var(--surface-1)',
        borderColor: '#141414',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,126,0.12)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = '#141414' }}
    >
      <div
        className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
        style={{ backgroundColor: 'var(--glow-subtle)' }}
      >
        {ICON_MAP[highlight.icon]}
      </div>
      <div>
        <h3 className="text-sm font-medium mb-0.5" style={{ color: 'var(--foreground)' }}>{highlight.title}</h3>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{highlight.description}</p>
      </div>
    </motion.div>
  )
}
```

Individua il `<motion.div variants={containerVariants} ...>` che wrappa le feature cards nel render. Cambia il grid da `grid-cols-2 sm:grid-cols-4` (o simile) a `grid-cols-2`:

```tsx
<motion.div
  variants={containerVariants}
  className="grid grid-cols-2 gap-2"
>
```

- [ ] **Step 4: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 5: Verifica visiva**

Su una pagina prodotto con pack: verifica che il risparmio appaia come "Risparmi €X,XX" con badge verde, e che il prezzo originale sia barrato. Verifica le feature cards in layout 2×2 con icone compatte a sinistra.

- [ ] **Step 6: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/components/ProductDetail.tsx && git commit -m "feat(product): pack savings badge, ATC gradient + success state, feature cards 2x2"
```

---

## Task 9: Checkout — form fields con focus ring e validation icons

**Files:**
- Modify: `storefront/src/app/[locale]/checkout/page.tsx`

- [ ] **Step 1: Aggiungi state per campo in focus**

Dopo la dichiarazione degli state esistenti (riga ~82), aggiungi:

```tsx
const [focusedField, setFocusedField] = useState<string | null>(null)
```

- [ ] **Step 2: Sostituisci `inputBase` e `inputStyle`**

Individua (riga ~235):
```tsx
const inputBase = 'w-full px-3 py-2 rounded border text-sm'
const inputStyle = { backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }
```

Sostituisci con:

```tsx
const inputBase = 'w-full px-3 py-2.5 rounded-lg border text-sm transition-[border-color,box-shadow]'

const inputStyle = (field: string, overrideValid?: boolean) => {
  const focused = focusedField === field
  const isInvalid =
    (field === 'email' && emailStatus === 'invalid') ||
    (field === 'postalCode' && postalCodeError)
  const isValid = overrideValid ||
    (field === 'email' && emailStatus === 'valid') ||
    (field === 'postalCode' && !postalCodeError && !!form.postalCode)
  return {
    backgroundColor: 'var(--surface-1)',
    color: 'var(--foreground)',
    transitionDuration: 'var(--dur-fast)',
    borderColor: isInvalid
      ? 'rgba(192,57,43,0.5)'
      : isValid
      ? 'rgba(90,156,82,0.4)'
      : focused
      ? 'rgba(200,169,126,0.5)'
      : 'var(--border)',
    boxShadow: isInvalid
      ? '0 0 0 3px rgba(192,57,43,0.06)'
      : focused
      ? '0 0 0 3px var(--glow-strong)'
      : 'none',
  }
}
```

- [ ] **Step 3: Aggiorna le label dei campi**

Ogni `<label className="...">` nel form shipping. Sostituisci le classi di label con `text-label block mb-1.5` e `style={{ color: 'var(--muted-fg)' }}`. Esempio per il campo nome:

```tsx
<label className="text-label block mb-1.5" style={{ color: 'var(--muted-fg)' }}>
  {t('name')}
</label>
<div className="relative">
  <input
    className={inputBase}
    style={inputStyle('name', !!form.name)}
    value={form.name}
    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
    onFocus={() => setFocusedField('name')}
    onBlur={() => setFocusedField(null)}
    placeholder={t('namePlaceholder')}
  />
  {form.name && (
    <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />
  )}
</div>
```

Applica lo stesso pattern a tutti i campi: `email`, `address`, `city`, `postalCode`. Per `email`:
- Stato `checking`: `<Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--muted-fg)' }} />`
- Stato `invalid`: `<XCircle size={14} ... style={{ color: 'var(--limited)' }} />` + `<p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>Email non valida — ricontrolla</p>`
- Stato `valid`: `<CheckCircle ... style={{ color: '#5a9c52' }} />`

Per `postalCode`:
- Se `postalCodeError`: `<XCircle>` + `<p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>Formato CAP non valido per {country}</p>`

- [ ] **Step 4: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/app/[locale]/checkout/page.tsx && git commit -m "feat(checkout): form fields label upgrade, focus ring, validation icons inline"
```

---

## Task 10: Checkout — free shipping bar, promo code, order summary, pay button, cart items

**Files:**
- Modify: `storefront/src/app/[locale]/checkout/page.tsx`

- [ ] **Step 1: Upgrade free shipping bar**

Individua il blocco `{remaining > 0 && (` (riga ~247). Sostituisci l'intero blocco con:

```tsx
{remaining > 0 && (
  <div
    className="rounded-xl p-4 mb-6 border"
    style={{ backgroundColor: 'var(--surface-1)', borderColor: '#151515' }}
  >
    <div className="flex justify-between items-center mb-3">
      <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>
        Aggiungi{' '}
        <span className="font-medium" style={{ color: 'var(--accent)' }}>
          €{remaining.toFixed(2)}
        </span>{' '}
        per la spedizione gratuita
      </p>
      <span className="text-mono text-xs" style={{ color: 'var(--muted-fg)' }}>
        {Math.round((cartTotal / (cartTotal + remaining)) * 100)}%
      </span>
    </div>
    {/* Progress bar con dot glow */}
    <div className="relative h-0.5 rounded-full overflow-visible" style={{ backgroundColor: 'var(--border)' }}>
      <div
        className="absolute left-0 top-0 h-0.5 rounded-full transition-[width]"
        style={{
          width: `${Math.min(100, (cartTotal / (cartTotal + remaining)) * 100)}%`,
          background: 'linear-gradient(90deg, var(--accent-dark), var(--accent))',
          transitionDuration: 'var(--dur-slow)',
        }}
      >
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
          style={{
            backgroundColor: 'var(--accent)',
            boxShadow: '0 0 6px rgba(200,169,126,0.6)',
          }}
        />
      </div>
    </div>
  </div>
)}
```

Sostituisci il blocco `{remaining === 0 && (` con:

```tsx
{remaining === 0 && (
  <div
    className="flex items-center gap-2 rounded-xl p-3.5 mb-6 border text-sm font-medium"
    style={{
      backgroundColor: 'rgba(45,140,39,0.08)',
      borderColor: 'rgba(45,140,39,0.2)',
      color: '#5a9c52',
    }}
  >
    <CheckCircle size={14} />
    {t('freeShippingApplied')}
  </div>
)}
```

- [ ] **Step 2: Upgrade promo code**

Individua la sezione promo nel form. Sostituisci l'input e il bottone "Applica":

```tsx
<div className="flex gap-2 mb-2">
  <input
    className={`${inputBase} flex-1 text-mono uppercase`}
    style={inputStyle('promo')}
    placeholder="CODICE PROMO"
    value={promoCode}
    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
    onFocus={() => setFocusedField('promo')}
    onBlur={() => setFocusedField(null)}
    disabled={promoStatus === 'valid'}
  />
  <button
    onClick={applyPromo}
    disabled={promoStatus === 'loading' || promoStatus === 'valid' || !promoCode.trim()}
    className="text-label px-4 rounded-lg border flex-shrink-0 transition-[border-color,background-color] disabled:opacity-40"
    style={{
      borderColor: 'rgba(200,169,126,0.2)',
      color: 'var(--accent)',
      transitionDuration: 'var(--dur-fast)',
    }}
  >
    {promoStatus === 'loading' ? <Loader2 size={14} className="animate-spin" /> : 'Applica'}
  </button>
</div>
```

Sotto, sostituisci gli stati success/invalid:

```tsx
{promoStatus === 'valid' && (
  <div
    className="flex items-center justify-between p-3 rounded-lg border text-sm"
    style={{
      backgroundColor: 'rgba(45,140,39,0.08)',
      borderColor: 'rgba(45,140,39,0.2)',
      color: '#5a9c52',
    }}
  >
    <span className="flex items-center gap-2">
      <CheckCircle size={14} />
      {promoCode} · {promoData?.discountPercent ? `−${promoData.discountPercent}%` : 'Spedizione gratuita'}
    </span>
    <button onClick={removePromo} className="text-label" style={{ color: 'var(--muted-fg)' }}>
      Rimuovi
    </button>
  </div>
)}
{promoStatus === 'invalid' && (
  <p className="flex items-center gap-1.5 text-xs mt-1" style={{ color: 'var(--limited)' }}>
    <XCircle size={12} /> Codice non valido o scaduto
  </p>
)}
```

- [ ] **Step 3: Upgrade order summary**

Individua la sidebar destra con il riepilogo ordine. Sostituisci le righe del summary con:

```tsx
{/* Riepilogo */}
<div className="space-y-0 mb-3">
  <p className="text-label mb-3" style={{ color: 'var(--muted-fg)' }}>Riepilogo ordine</p>

  <div className="flex justify-between py-2" style={{ borderBottom: '1px solid var(--surface-3)' }}>
    <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>Subtotale</span>
    <span className="text-mono text-sm">€{cartTotal.toFixed(2)}</span>
  </div>

  <div className="flex justify-between py-2" style={{ borderBottom: '1px solid var(--surface-3)' }}>
    <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>Spedizione — {country}</span>
    <span className="text-mono text-sm" style={{ color: shipping.isFree ? '#5a9c52' : 'var(--foreground)' }}>
      {shipping.isFree ? 'Gratuita' : `€${shipping.cost.toFixed(2)}`}
    </span>
  </div>

  {proDiscount > 0 && (
    <div className="flex justify-between py-2" style={{ borderBottom: '1px solid var(--surface-3)' }}>
      <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>
        {promoData?.discountPercent ? `Sconto ${promoData.discountPercent}%` : 'Sconto'}
      </span>
      <span className="text-mono text-sm" style={{ color: '#5a9c52' }}>−€{proDiscount.toFixed(2)}</span>
    </div>
  )}
</div>

{/* Divider */}
<div className="h-px mb-3" style={{ backgroundColor: 'var(--border)' }} />

{/* Totale */}
<div className="flex justify-between items-baseline mb-4">
  <span className="text-sm font-medium">Totale IVA inc.</span>
  <span className="text-mono font-bold" style={{ fontSize: 22, color: 'var(--accent)', letterSpacing: '-0.01em' }}>
    €{grandTotal.toFixed(2)}
  </span>
</div>
```

- [ ] **Step 4: Upgrade pay button**

Individua il bottone di pagamento. Sostituisci:

```tsx
<button
  onClick={handlePayment}
  disabled={!canPay}
  className="relative w-full overflow-hidden rounded-lg text-label font-semibold flex items-center justify-center gap-2 transition-opacity disabled:opacity-40"
  style={{ height: 56, backgroundColor: 'var(--accent)', color: '#080808' }}
>
  <span
    className="absolute inset-0 pointer-events-none"
    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 55%)' }}
    aria-hidden
  />
  {loading
    ? <Loader2 size={18} className="animate-spin" />
    : <>{t('pay')}</>
  }
</button>
<p className="text-center mt-2.5 text-xs" style={{ color: 'var(--muted-fg)' }}>
  🔒 Stripe · Pagamento sicuro · Dati crittografati
</p>
```

- [ ] **Step 5: Upgrade cart items**

Individua il `.map((item) => (` dei cart items (riga ~269). Per ogni item, applica:

**Pack badge** — individua `{item.packName && (<span ...>{item.packName}</span>)}` e sostituisci:
```tsx
{item.packName && (
  <span
    className="text-label px-1.5 py-0.5 rounded border"
    style={{
      backgroundColor: 'rgba(200,169,126,0.08)',
      borderColor: 'rgba(200,169,126,0.2)',
      color: 'var(--accent)',
    }}
  >
    {item.packName}
  </span>
)}
```

**Prezzo con barrato** — individua `<div className="text-right flex-shrink-0">` e sostituisci il contenuto:
```tsx
<div className="text-right flex-shrink-0 flex flex-col justify-start gap-0.5">
  {item.originalUnitPrice && (
    <span className="text-xs line-through" style={{ color: 'var(--muted-fg)', opacity: 0.5 }}>
      €{(item.originalUnitPrice * item.quantity).toFixed(2)}
    </span>
  )}
  <span className="text-mono font-semibold text-sm">
    €{(item.price * item.quantity).toFixed(2)}
  </span>
</div>
```

**Bottone rimuovi** — individua `<button onClick={() => remove(item.sku)} ...><Trash2 size={14} /></button>` e sostituisci:
```tsx
<button
  onClick={() => remove(item.sku)}
  className="text-xs transition-colors"
  style={{ color: 'var(--muted-fg)', transitionDuration: 'var(--dur-fast)' }}
  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--limited)' }}
  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--muted-fg)' }}
>
  ✕ Rimuovi
</button>
```

**Thumbnail border** — al `<div className="w-16 h-16 rounded overflow-hidden ...">` aggiungi `border` e `style={{ ..., border: '1px solid var(--surface-3)' }}`.

- [ ] **Step 6: Verifica TypeScript**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

Atteso: nessun errore.

- [ ] **Step 7: Verifica visiva**

Avvia `npm run dev`, vai al checkout con almeno un item nel carrello. Verifica:
- Free shipping bar: gradient fill con dot glow e percentuale
- Promo code: input monospace, success state con codice e percentuale visibili
- Order summary: divider netto prima del totale, totale in 22px monospace
- Pay button: gradient overlay, trust line sotto
- Cart items: badge pack glassmorphism, prezzo barrato se pack, "✕ Rimuovi" testuale

- [ ] **Step 8: Build finale**

```bash
cd /home/ab/dev/foolish-storefront/storefront && npm run build
```

Atteso: build completata senza errori TypeScript. Warning Next.js su immagini o bundle size sono accettabili.

- [ ] **Step 9: Commit finale**

```bash
cd /home/ab/dev/foolish-storefront && git add storefront/src/app/[locale]/checkout/page.tsx && git commit -m "feat(checkout): shipping bar glow, promo monospace, summary hierarchy, pay button trust line, cart items upgrade"
```

---

## Self-Review Checklist

- [x] **Spec §1 Design tokens** → Task 1 (globals.css) + Task 2 (motion.ts)
- [x] **Spec §2 Home — hero** → Task 5
- [x] **Spec §2 Home — trust badges** → Task 5
- [x] **Spec §2 Home — bento hover** → Task 4 (ProductCard)
- [x] **Spec §2 Home — scroll reveals** → Task 3 (BentoGrid usa DURATION/EASE; stagger via delay prop già presente — invariato by design, BentoItem già gestisce `isInView`)
- [x] **Spec §3 Product — gallery thumbnails** → Task 6
- [x] **Spec §3 Product — crossfade** → Task 6
- [x] **Spec §3 Product — variant pills** → Task 7
- [x] **Spec §3 Product — stock badge** → Task 7
- [x] **Spec §3 Product — pack selector** → Task 8
- [x] **Spec §3 Product — ATC button** → Task 8
- [x] **Spec §3 Product — feature cards 2×2** → Task 8
- [x] **Spec §4 Checkout — form fields** → Task 9
- [x] **Spec §4 Checkout — free shipping bar** → Task 10
- [x] **Spec §4 Checkout — promo code** → Task 10
- [x] **Spec §4 Checkout — order summary** → Task 10
- [x] **Spec §4 Checkout — pay button** → Task 10
- [x] **Spec §4 Checkout — cart items** → Task 10

**Nessun gap rilevato.** Tutti i requisiti della spec hanno una task corrispondente.
