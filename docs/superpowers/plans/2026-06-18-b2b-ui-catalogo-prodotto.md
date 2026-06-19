# B2B Portal UI — Catalogo & Pagina Prodotto

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arricchire il portale rivenditori con storytelling del brand sulla pagina catalogo e un selettore quantità usabile + layout immagine migliorato sulla pagina prodotto.

**Architecture:** Due task indipendenti su due file client/server. Il catalogo è un Server Component (aggiungere sezioni statiche inline). La pagina prodotto è già un Client Component — modificare il layout immagine e sostituire i bottoni +/- con input numerico + preset.

**Tech Stack:** Next.js 15 App Router, React, CSS inline con custom properties (`var(--accent)`, `var(--card)`, ecc.), Cormorant Garamond (display), Outfit (body). Nessuna dipendenza nuova.

---

## Contesto codebase

### Design system (da `b2b/src/app/globals.css`)
```css
--background: #080808;
--foreground: #f0ede8;
--accent: #c8a97e;         /* oro */
--muted-fg: #888077;
--border: #1e1e1e;
--card: #0f0f0f;
--surface-2: #0f0f0f;
--surface-3: #141414;
--surface-4: #1a1a1a;
--dur-fast: 150ms;
```
Font display: `fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600`

Tutti gli stili vanno come `style={{ ... }}` inline. **Non usare className Tailwind per colori/spacing** (eccezione: `w-full`, `flex`, layout generici già presenti).

### Tipi rilevanti (da `b2b/src/lib/cms.ts`)
```typescript
interface ResellerProduct {
  id: number; slug: string; name: string; basePrice: number;
  priceTiers: PriceTier[]; variants: ProductVariant[];
  images: { url: string; alt?: string }[];
  description?: string;
}
interface PriceTier { minQty: number; maxQty: number | null; discountPercent: number }
interface ProductVariant { id: string; sku: string; label: string; price: number }
```

### Funzioni pricing (da `b2b/src/lib/pricing.ts`)
```typescript
calculateUnitPrice(basePrice, qty, tiers): number
calculateLineTotal(basePrice, qty, tiers): number
formatPrice(eur): string  // → "€ 12,50"
```

---

## File Structure

| File | Tipo modifica |
|---|---|
| `b2b/src/app/catalogo/page.tsx` | Aggiunta hero + brand pillars sopra la griglia prodotti |
| `b2b/src/app/catalogo/[slug]/page.tsx` | Nuovo layout immagine + selettore quantità smart |

Nessun file nuovo.

---

## Task 1: Catalogo — hero storytelling + brand pillars

**Files:**
- Modify: `b2b/src/app/catalogo/page.tsx`

### Contesto

Il catalogo è visitato da tatuatori che arrivano dall'outreach di Frank e non conoscono ancora bene Foolish. Serve una sezione sopra la griglia prodotti che spieghi:
- Produzione artigianale in laboratorio (tempi leggermente più lunghi dell'industriale — ma è una scelta, non un difetto)
- Ogni lotto cambia per consistenza e colorazione → il cliente del rivenditore non si stanca mai
- Questo garantisce al rivenditore rivendita continua

La sezione deve essere visivamente impattante ma non pesante: headline grande, tre pillar card, poi la griglia.

- [ ] **Step 1: Sostituisci `b2b/src/app/catalogo/page.tsx` con questa versione**

```tsx
import { fetchResellerProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export const dynamic = 'force-dynamic'

const PILLARS = [
  {
    icon: '✦',
    title: 'Produzione artigianale',
    body: 'Ogni foglio è lavorato a mano nel nostro laboratorio in piccoli lotti. Non produciamo in serie — e si vede.',
  },
  {
    icon: '◈',
    title: 'Ogni lotto, unico',
    body: 'Consistenza e colorazione variano naturalmente tra un lotto e l\'altro. I tuoi clienti tatueranno sempre su qualcosa di leggermente diverso.',
  },
  {
    icon: '⟳',
    title: 'Clienti fedeli garantiti',
    body: 'Un prodotto che cambia è un prodotto che non annoia. Chi tatuatore su Foolish torna per tatuare ancora su Foolish.',
  },
]

export default async function CatalogoPage() {
  const products = await fetchResellerProducts()

  return (
    <div>
      {/* ── HERO ── */}
      <section style={{ marginBottom: '4rem', paddingBottom: '3rem', borderBottom: '1px solid var(--border)' }}>
        <p style={{
          fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.18em',
          color: 'var(--accent)', marginBottom: '1rem',
        }}>
          Portale Rivenditori
        </p>
        <h1 style={{
          fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
          fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1.1,
          color: 'var(--foreground)', marginBottom: '1.5rem', maxWidth: '28rem',
        }}>
          Ogni foglio di pelle,<br />un&apos;opera irripetibile.
        </h1>
        <p style={{
          fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.75,
          maxWidth: '38rem', marginBottom: '2.5rem',
        }}>
          The Foolish Butcher produce pelli sintetiche per tatuaggio artigianalmente, in piccoli lotti curati uno ad uno.
          I tempi di consegna sono leggermente superiori alla produzione industriale — non per inefficienza, ma per scelta.
          Ogni lotto cambia per consistenza e tonalità: questo è il segreto che trasforma i tuoi clienti in <em style={{ color: 'var(--foreground)', fontStyle: 'italic' }}>habitué</em>.
        </p>

        {/* Pillar cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1px',
          background: 'var(--border)',
          border: '1px solid var(--border)',
          borderRadius: '1rem',
          overflow: 'hidden',
        }}>
          {PILLARS.map((p) => (
            <div key={p.title} style={{ background: 'var(--card)', padding: '1.75rem 1.5rem' }}>
              <span style={{ fontSize: '1.1rem', color: 'var(--accent)', display: 'block', marginBottom: '0.875rem' }}>
                {p.icon}
              </span>
              <h3 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.5rem' }}>
                {p.title}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', lineHeight: 1.65 }}>
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATALOGO ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1.75rem' }}>
          <h2 style={{
            fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
            fontSize: '1.5rem', color: 'var(--foreground)',
          }}>
            Catalogo
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
            Prezzi riservati ai rivenditori autorizzati
          </p>
        </div>

        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--muted-fg)' }}>
            <p>Nessun prodotto disponibile al momento.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
            {products.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```
Expected: nessun output (zero errori).

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/app/catalogo/page.tsx
git commit -m "feat(b2b): catalogo — hero storytelling + brand pillars artigianalità"
```

---

## Task 2: Pagina prodotto — layout immagine + selettore quantità smart

**Files:**
- Modify: `b2b/src/app/catalogo/[slug]/page.tsx`

### Contesto

Problemi attuali:
1. L'immagine è ritagliata in `aspectRatio: '16/9'` — le foto Foolish sono verticali/quadrate, risultano tagliate male
2. Il selettore quantità usa +/- uno alla volta — impossibile selezionare 500 pezzi

Soluzione:
1. Layout a due colonne su schermi larghi (≥720px): immagine a sinistra (aspect 3/4, objectFit cover), dettagli a destra. Su mobile: immagine sopra, dettagli sotto.
2. Selettore quantità: preset buttons (50 · 100 · 200 · 500) + input numerico diretto. I preset impostano la quantità, l'input permette valori liberi. Entrambi aggiornano `qty`.

- [ ] **Step 1: Sostituisci `b2b/src/app/catalogo/[slug]/page.tsx` con questa versione**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ResellerProduct, ProductVariant } from '@/lib/cms'
import { calculateUnitPrice, calculateLineTotal, formatPrice } from '@/lib/pricing'
import { PriceTierTable } from '@/components/PriceTierTable'
import { useCart } from '@/lib/cart'

const QTY_PRESETS = [50, 100, 200, 500]

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [product, setProduct] = useState<ResellerProduct | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [qty, setQty] = useState(50)
  const [qtyInput, setQtyInput] = useState('50')
  const [added, setAdded] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const { addItem } = useCart()
  const router = useRouter()

  useEffect(() => {
    params.then(p => setSlug(p.slug))
  }, [params])

  useEffect(() => {
    if (!slug) return
    fetch(`/api/catalog?slug=${slug}`)
      .then(r => {
        if (!r.ok) { setNotFound(true); return null }
        return r.json()
      })
      .then(data => {
        if (!data) return
        setProduct(data)
        setSelectedVariant(data.variants?.[0] ?? null)
      })
  }, [slug])

  function applyQty(value: number) {
    const clamped = Math.max(1, value)
    setQty(clamped)
    setQtyInput(String(clamped))
  }

  function handleQtyInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQtyInput(e.target.value)
    const n = parseInt(e.target.value, 10)
    if (!isNaN(n) && n >= 1) setQty(n)
  }

  function handleQtyInputBlur() {
    const n = parseInt(qtyInput, 10)
    applyQty(isNaN(n) ? 50 : n)
  }

  if (notFound) return (
    <div>
      <button
        onClick={() => router.back()}
        style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
      >
        ← Torna al catalogo
      </button>
      <p style={{ color: 'var(--muted-fg)' }}>Prodotto non trovato.</p>
    </div>
  )
  if (!product) return <p style={{ color: 'var(--muted-fg)' }}>Caricamento...</p>

  const tiers = product.priceTiers ?? []
  const basePrice = selectedVariant?.price ?? product.basePrice
  const unitPrice = calculateUnitPrice(basePrice, qty, tiers)
  const lineTotal = calculateLineTotal(basePrice, qty, tiers)
  const image = product.images?.[0]

  function handleAdd() {
    if (!selectedVariant) return
    addItem({
      productId: product!.id,
      productSlug: product!.slug,
      productName: product!.name,
      variantSku: selectedVariant.sku,
      variantLabel: selectedVariant.label,
      unitPrice: selectedVariant.price,
      qty,
      priceTiers: tiers,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <div>
      <button
        onClick={() => router.back()}
        style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.75rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'block' }}
      >
        ← Torna al catalogo
      </button>

      {/* Layout a due colonne su schermi larghi */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: '3rem', alignItems: 'start' }}>

        {/* ── IMMAGINE ── */}
        <div>
          {image ? (
            <div style={{
              borderRadius: '1rem', overflow: 'hidden',
              background: 'var(--surface-2)',
              aspectRatio: '3 / 4',
            }}>
              <img
                src={image.url}
                alt={image.alt ?? product.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </div>
          ) : (
            <div style={{
              borderRadius: '1rem', background: 'var(--surface-3)',
              aspectRatio: '3 / 4',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'var(--muted-fg)', fontSize: '0.75rem' }}>Nessuna immagine</span>
            </div>
          )}
        </div>

        {/* ── DETTAGLI ── */}
        <div>
          <h1 style={{
            fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
            fontSize: '2.25rem', color: 'var(--foreground)', marginBottom: '0.5rem', lineHeight: 1.1,
          }}>
            {product.name}
          </h1>

          {product.description && (
            <p style={{ fontSize: '0.875rem', color: 'var(--muted-fg)', lineHeight: 1.7, marginBottom: '1.5rem' }}>
              {product.description}
            </p>
          )}

          {/* Varianti */}
          {product.variants && product.variants.length > 0 && (
            <div style={{ marginBottom: '1.75rem' }}>
              <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
                Formato
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {product.variants.map(v => (
                  <button
                    key={v.sku}
                    onClick={() => setSelectedVariant(v)}
                    style={{
                      border: `1px solid ${selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: '0.5rem',
                      padding: '0.4rem 0.9rem',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      background: selectedVariant?.sku === v.sku ? 'rgba(200,169,126,0.1)' : 'transparent',
                      color: selectedVariant?.sku === v.sku ? 'var(--accent)' : 'var(--foreground)',
                      fontWeight: selectedVariant?.sku === v.sku ? 500 : 400,
                      transition: 'border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast)',
                    }}
                  >
                    {v.label} — {formatPrice(v.price)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Selettore quantità */}
          <div style={{ marginBottom: '1.75rem' }}>
            <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
              Quantità
            </p>

            {/* Preset buttons */}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {QTY_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => applyQty(p)}
                  style={{
                    border: `1px solid ${qty === p ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: '0.5rem',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    background: qty === p ? 'rgba(200,169,126,0.1)' : 'transparent',
                    color: qty === p ? 'var(--accent)' : 'var(--muted-fg)',
                    fontWeight: qty === p ? 500 : 400,
                    transition: 'border-color var(--dur-fast), background var(--dur-fast), color var(--dur-fast)',
                  }}
                >
                  {p} pz
                </button>
              ))}
            </div>

            {/* Input numerico libero */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="number"
                min={1}
                value={qtyInput}
                onChange={handleQtyInputChange}
                onBlur={handleQtyInputBlur}
                style={{
                  width: '6rem',
                  border: '1px solid var(--border)',
                  borderRadius: '0.5rem',
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.875rem',
                  background: 'var(--surface-2)',
                  color: 'var(--foreground)',
                  outline: 'none',
                }}
              />
              <span style={{ fontSize: '0.8rem', color: 'var(--muted-fg)' }}>
                Prezzo/pz: <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{formatPrice(unitPrice)}</span>
                {unitPrice < basePrice && (
                  <span style={{ textDecoration: 'line-through', marginLeft: '0.5rem', opacity: 0.5, fontSize: '0.75rem' }}>
                    {formatPrice(basePrice)}
                  </span>
                )}
              </span>
            </div>
          </div>

          {/* Tabella fasce prezzo */}
          <PriceTierTable tiers={tiers} basePrice={basePrice} currentQty={qty} />

          {/* CTA */}
          <div style={{ marginTop: '2rem', display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
            <p style={{
              fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
              fontSize: '1.75rem', color: 'var(--foreground)',
            }}>
              {formatPrice(lineTotal)}
            </p>
            <button
              onClick={handleAdd}
              style={{
                background: added ? 'rgba(200,169,126,0.15)' : 'var(--accent)',
                color: added ? 'var(--accent)' : '#080808',
                border: added ? '1px solid var(--accent)' : '1px solid transparent',
                borderRadius: '0.625rem',
                padding: '0.75rem 2rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'background var(--dur-fast), color var(--dur-fast), border-color var(--dur-fast)',
                letterSpacing: '0.04em',
              }}
            >
              {added ? '✓ Aggiunto al carrello' : 'Aggiungi al carrello'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```
Expected: nessun output (zero errori).

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add "b2b/src/app/catalogo/[slug]/page.tsx"
git commit -m "feat(b2b): pagina prodotto — layout 2 colonne + selettore quantità con preset"
```

---

## Push finale

Dopo entrambi i task:

```bash
cd /home/ab/dev/foolish-storefront
git push origin main
```

---

## Note responsive

Il layout a due colonne (`gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)'`) si riduce automaticamente su schermi stretti perché `minmax(0, Xfr)` con una colonna che non ha spazio sufficiente andrà a capo. Se si vuole forzare la singola colonna su mobile si può aggiungere un `@media` in globals.css — ma non è necessario per il lancio.
