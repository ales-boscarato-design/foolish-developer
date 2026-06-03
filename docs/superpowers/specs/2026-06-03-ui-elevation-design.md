# UI Elevation — Foolish Storefront

**Data:** 2026-06-03
**Scope:** Design System + Home + Product page + Checkout
**Livello:** Elevation (stessa direzione dark luxury, eseguita con più precisione e pattern 21st.dev)
**Approccio:** Design System First — i token precedono le pagine; la Home è il laboratorio del sistema

---

## 1. Design System — globals.css

### 1.1 Spacing Scale

Formalizzare in CSS custom properties. Base 4px. I valori Tailwind esistenti rimangono compatibili — i token diventano il riferimento semantico.

```css
:root {
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
}
```

### 1.2 Motion Tokens

**Duration** (aggiungere in `:root`):
```css
--dur-instant:   80ms;   /* toggle, focus ring */
--dur-fast:      150ms;  /* hover state */
--dur-normal:    250ms;  /* panel, drawer */
--dur-slow:      450ms;  /* reveal, card */
--dur-cinematic: 750ms;  /* hero, pageload */
```

**Easing** (aggiungere in `:root`):
```css
--ease-out:        cubic-bezier(0, 0, 0.2, 1);
--ease-spring:     cubic-bezier(0.16, 1, 0.3, 1); /* già usato, ora nominato */
--ease-emphasized: cubic-bezier(0.4, 0, 0.6, 1);
--ease-decelerate: cubic-bezier(0, 0, 0.2, 1);
```

Esportare come costanti TypeScript in `src/lib/motion.ts` per uso in Framer Motion:
```ts
export const DURATION = {
  instant:   0.08,
  fast:      0.15,
  normal:    0.25,
  slow:      0.45,
  cinematic: 0.75,
} as const

export const EASE = {
  out:        [0, 0, 0.2, 1],
  spring:     [0.16, 1, 0.3, 1],
  emphasized: [0.4, 0, 0.6, 1],
} as const
```

### 1.3 Typography Scale

Font families invariate (Outfit + Cormorant Garamond). Si fissano i step con line-height e tracking espliciti.

| Nome       | Size  | Line-height | Tracking   | Font                  | Uso                         |
|------------|-------|-------------|------------|-----------------------|-----------------------------|
| Display XL | 72px  | 1.0         | −0.02em    | Cormorant italic      | Hero headline               |
| Display L  | 48px  | 1.05        | −0.015em   | Cormorant italic      | Section headline major      |
| Display M  | 32px  | 1.1         | −0.01em    | Cormorant italic      | Section headline minor      |
| Heading    | 20px  | 1.3         | 0          | Outfit 500            | Card title, panel header    |
| Body       | 15px  | 1.65        | 0          | Outfit 400            | Testo corrente              |
| Label      | 11px  | 1.4         | +0.1em     | Outfit 400 uppercase  | Section tag, form label     |
| Mono       | 12px  | 1.4         | +0.04em    | monospace             | Prezzi, seriali, codici     |

Aggiungere classi utility in `globals.css`:
```css
.text-label  { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; }
.text-mono   { font-family: monospace; letter-spacing: 0.04em; }
```

### 1.4 Surface Layers

Aggiungere in `:root` (mantiene invariati `--background`, `--card`, `--muted`):
```css
--surface-base: #080808;  /* = --background */
--surface-1:    #0a0a0a;
--surface-2:    #0f0f0f;  /* = --card attuale */
--surface-3:    #141414;
--surface-4:    #1a1a1a;  /* hover/active */
```

### 1.5 Accent Glow

```css
--glow-subtle: rgba(200, 169, 126, 0.06);
--glow-medium: rgba(200, 169, 126, 0.12);
--glow-strong: rgba(200, 169, 126, 0.20);  /* focus ring */
```

### 1.6 Invariato

Palette colori (`--background`, `--foreground`, `--accent`, `--accent-dark`, `--muted`, `--muted-fg`, `--border`, `--limited`), grain texture, font families, `@keyframes fade-up`, `@keyframes marquee-scroll`, `@keyframes limited-pulse`, classi `.font-display`, `.font-artisan`.

---

## 2. Home Page

### 2.1 Pattern Section Header (trasversale a tutte le sezioni)

Sostituire intestazioni libere con pattern uniforme:
```jsx
<div className="text-label" style={{ color: 'var(--accent)', opacity: 0.7 }}>
  {sectionTag} {/* es. "Categoria", "Limited", "Chi siamo" */}
</div>
<h2 className="font-display" style={{ fontSize: 32, letterSpacing: '-0.01em' }}>
  {headline}
</h2>
```
La linea decorativa (`.ink-line`) può seguire il label come accent visivo orizzontale.

### 2.2 Hero

| Elemento | Cambia | Spec |
|---|---|---|
| Label tag | Aggiunge | `<div className="text-label">Pelle sintetica artigianale</div>` prima del titolo |
| Headline | Riduce testo | Più breve e incisiva; `font-size: 72px`, `line-height: 1.0`, `letter-spacing: -0.02em` |
| Sottotitolo | Aumenta respiro | `line-height: 1.65`, `max-width: 480px`, `font-size: 15px` |
| Gap hero-left | Aumenta | `gap: var(--space-6)` → 24px (da ~12px) |
| CTA primario | Upgrade | `padding: var(--space-3) var(--space-8)`, `letter-spacing: 0.06em`, `text-transform: uppercase`, `gradient overlay ::before` |
| CTA ghost | Upgrade | `border-color: rgba(var(--accent-rgb), 0.2)`, `color: var(--accent)` (non grigio neutro) |
| Hero image | Upgrade | `box-shadow: 0 32px 64px rgba(0,0,0,0.6)`, radial glow accent in background via pseudo-element |

### 2.3 Bento Cells — hover state

Per ogni `BentoItem` aggiungere:
- `background` hover: `var(--glow-subtle)` con `transition: background var(--dur-fast) var(--ease-out)`
- `border-color` hover: `rgba(200, 169, 126, 0.15)` 
- Radial gradient `::before` con opacity 0→1 on hover (glow interno all'angolo)

Label di formato/categoria in alto nella cella (sopra il nome prodotto): `<span className="text-label">{format}</span>`

Prezzo sempre monospace con decimali espliciti: `€38,00` (non `€38`).

### 2.4 Scroll Reveals — da delay CSS a Framer Motion variants

Sostituire le classi `.animate-fade-up-d1/d5` con `variants` + `staggerChildren` per ogni sezione:

```ts
const sectionVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
}
const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE.spring } },
}
```

Sequenza per ogni sezione:
1. Label tag (opacity, x: -12→0, dur-normal)
2. Ink-line extend (scaleX 0→1, transform-origin left, dur-slow, ease-spring)
3. Headline SplitText (stagger 0.035s/lettera, delay +120ms)
4. Bento cells stagger (stagger 0.06s, delay +200ms)

### 2.5 Trust Badges

- Padding interno aumentato: `padding: var(--space-3) var(--space-3)` → `12px`
- Testo più specifico: "Spedizione in 24–48h" invece di "Spedizione rapida", "Gratis sopra €60" invece di "Spedizione gratuita"
- Hover: `border-color: rgba(var(--accent-rgb), 0.2)` con transizione `var(--dur-fast)`

---

## 3. Product Page

### 3.1 Gallery — thumbnail strip

Sostituire i dot indicators con thumbnail strip:

```jsx
{effectiveGallery.length > 1 && (
  <div className="flex gap-2 mt-3">
    {effectiveGallery.slice(0, 4).map((img, i) => (
      <button
        key={i}
        onClick={() => setActiveImage(i)}
        className="relative w-11 h-11 rounded-lg overflow-hidden border flex-shrink-0"
        style={{
          borderColor: i === activeImage
            ? 'var(--accent)'
            : 'var(--border)',
          boxShadow: i === activeImage
            ? '0 0 0 1px rgba(200,169,126,0.3)'
            : 'none',
        }}
      >
        <Image src={cmsImageUrl(img.url)} alt="" fill className="object-cover" sizes="44px" />
      </button>
    ))}
    {effectiveGallery.length > 4 && (
      <div className="w-11 h-11 rounded-lg border flex items-center justify-center text-xs"
        style={{ borderColor: 'var(--border)', color: 'var(--muted-fg)' }}>
        +{effectiveGallery.length - 4}
      </div>
    )}
  </div>
)}
```

### 3.2 Gallery — crossfade AnimatePresence

Avvolgere l'immagine principale in `AnimatePresence mode="sync"` con `key={activeImage}`:

```jsx
<AnimatePresence mode="sync">
  <motion.div
    key={activeImage}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: DURATION.fast, ease: EASE.out }}
    className="absolute inset-0"
  >
    <Image ... onLoad={() => setImageLoaded(true)} />
  </motion.div>
</AnimatePresence>
```

Questo gestisce il cambio variante senza flash nero. `ImageSkeleton` e `imageLoaded` rimangono per il caricamento iniziale della pagina.

### 3.3 Variant Pills — glass effect

```jsx
className={`px-4 py-2.5 text-sm rounded-lg border transition-all min-h-[44px] relative ${
  isSelected
    ? 'border-accent/50 bg-accent/10 text-accent font-medium shadow-[0_0_0_1px_rgba(200,169,126,0.15),0_4px_12px_rgba(200,169,126,0.06)]'
    : !available
    ? 'opacity-20 cursor-not-allowed border-border line-through'
    : 'border-[var(--border)] hover:border-accent/25 hover:text-accent'
}`}
```

Checkmark badge sulla pill selezionata via `::after` (CSS) o overlay `<span>` assoluto top-right.

Stock "Ultimi": badge inline `<span className="ml-2 text-xs px-1 py-0.5 rounded" style={{ background: 'rgba(192,57,43,0.1)', color: 'var(--limited)' }}>Ultimi</span>` invece del solo puntino `•`.

### 3.4 Stock Badge

Sostituire il solo puntino rosso/verde con badge esplicita sotto il prezzo:
```jsx
<span className="inline-flex items-center gap-1.5 text-label mt-2 px-2 py-1 rounded"
  style={
    status === 'available'
      ? { background: 'rgba(45,90,39,0.15)', color: '#5a9c52', border: '1px solid rgba(90,156,82,0.2)' }
      : { background: 'rgba(192,57,43,0.1)', color: 'var(--limited)', border: '1px solid rgba(192,57,43,0.2)' }
  }>
  ● {status === 'available' ? 'Disponibile' : 'Ultimi pezzi'}
</span>
```

### 3.5 Pack Selector

| Elemento | Cambia | Spec |
|---|---|---|
| Discount label | `−10%` → risparmio assoluto | `"Risparmi €{saving.toFixed(2)}"` in badge verde |
| Reference price | Aggiunge | Prezzo originale barrato sopra il prezzo scontato |
| Hover | Aggiunge | `border-color: rgba(accent, 0.2)`, `background: var(--glow-subtle)` |
| Layout | Left/right | Info pack a sinistra, pricing allineato a destra |

### 3.6 Add to Cart CTA

- Height: 48px → 52px
- Testo: uppercase, `letter-spacing: 0.08em`
- Gradient overlay `::before`: `linear-gradient(135deg, rgba(255,255,255,0.15) 0%, transparent 50%)`
- Success state: AnimatePresence `layoutId="atc-btn"`, background `#2d5a27`, colore `#7dc972`, border `1px solid rgba(125,201,114,0.2)`
- Qty row: label "Quantità" separata dalla CTA (non in-row), `margin-bottom: var(--space-3)`

### 3.7 Feature Cards — layout 2×2

```jsx
// Da: grid-cols-4 text-center icona 48px
// A:  grid-cols-2 flex-row icona 32px
<div className="grid grid-cols-2 gap-2">
  {highlights.map(h => (
    <div className="flex gap-3 items-start p-4 rounded-lg border transition-colors"
      style={{ background: 'var(--surface-1)', borderColor: '#141414' }}>
      <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
        style={{ background: 'var(--glow-subtle)' }}>
        {ICON_MAP[h.icon]}
      </div>
      <div>
        <p className="text-sm font-medium">{h.title}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>{h.description}</p>
      </div>
    </div>
  ))}
</div>
```

Rimuovere `whileHover={{ y: -4 }}` dalle feature card: troppo energico per un elemento informativo.

---

## 4. Checkout

### 4.1 Form Fields

`inputBase` attuale (`'w-full px-3 py-2 rounded border text-sm'`) diventa:

```ts
const inputBase = 'w-full px-3 py-2.5 rounded-lg border text-sm transition-[border-color,box-shadow]'
const inputStyle = {
  backgroundColor: 'var(--surface-1)',
  borderColor: 'var(--border)',
  color: 'var(--foreground)',
}
const inputFocusStyle = {
  borderColor: 'rgba(200,169,126,0.5)',
  boxShadow: '0 0 0 3px var(--glow-strong)',
}
```

Focus ring applicabile via CSS `:focus-within` sul wrapper, oppure con `onFocus`/`onBlur` + state `focusedField` se serve controllo per-field.

**Label**: da `text-sm font-medium` a `text-label` (9px uppercase tracking) — coerente col design system.

**Validation icons** (wrapper `<div className="relative">`):
- Valid: `<CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: '#5a9c52' }} />`
- Invalid: `<XCircle size={14} ...` rosso + testo errore sotto `<p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>`
- Checking: `<Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: 'var(--muted-fg)' }} />`

### 4.2 Free Shipping Bar

```jsx
// Endpoint glow dot
<div className="relative h-1 rounded-full overflow-visible" style={{ background: 'var(--border)' }}>
  <div
    className="absolute left-0 top-0 h-1 rounded-full transition-[width] duration-500"
    style={{
      width: `${pct}%`,
      background: 'linear-gradient(90deg, var(--accent-dark), var(--accent))',
    }}
  >
    {/* Dot glow */}
    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full"
      style={{ background: 'var(--accent)', boxShadow: '0 0 6px rgba(200,169,126,0.6)' }} />
  </div>
</div>
```

Percentuale `{pct}%` in `text-mono` top-right del banner.

Stato raggiunta: sostituire il `<div>` con testo colorato con:
```jsx
<div className="flex items-center gap-2 p-3 rounded-lg border"
  style={{ background: 'rgba(45,140,39,0.08)', borderColor: 'rgba(45,140,39,0.2)', color: '#5a9c52' }}>
  <CheckCircle size={14} /> {t('freeShippingApplied')}
</div>
```

### 4.3 Promo Code

- Input: `font-family: monospace`, `letter-spacing: 0.06em`, `text-transform: uppercase`
- Bottone: ghost accent (`border: 1px solid rgba(accent, 0.2)`, `color: var(--accent)`)
- Success: badge compatta con nome codice visibile + sconto + "Rimuovi" in grigio (non un toast)
- Invalid: testo rosso inline con `XCircle` — nessun `alert()`

### 4.4 Order Summary

- Section label "Riepilogo ordine" (`text-label`) sopra le righe
- "Spedizione — {country}" per contestualizzare
- Divider `<hr>` (`border-color: var(--border)`) prima del totale (non solo `border-bottom` sui row)
- Totale: `font-size: 22px`, `font-family: monospace`, `letter-spacing: -0.01em`

### 4.5 Pay Button

```jsx
<button
  disabled={!canPay || loading}
  className="w-full h-14 rounded-lg text-label font-semibold relative overflow-hidden"
  style={{ background: 'var(--accent)', color: '#080808' }}
>
  <span className="absolute inset-0 pointer-events-none"
    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 55%)' }} />
  {loading ? <Loader2 size={18} className="animate-spin" /> : '🔒  Procedi al pagamento'}
</button>
<p className="text-center mt-2.5 text-xs" style={{ color: 'var(--muted-fg)' }}>
  🔒 Stripe · Pagamento sicuro · Dati crittografati
</p>
```

Rimuovere il prezzo dal testo del bottone (già visibile nel riepilogo sopra).

### 4.6 Cart Items nel Checkout

- Pack badge: glassmorphism accent invece di solid fill (`background: rgba(accent, 0.1)`, `border: 1px solid rgba(accent, 0.2)`)
- Prezzo originale barrato sopra il prezzo scontato (identico a product page)
- "✕ Rimuovi" testo invece di icona `<Trash2>` (più leggibile, meno aggressivo)
- Thumbnail: `border: 1px solid var(--surface-3)` per separare dal background scuro
- Qty controls: stesse dimensioni e colori della product page (coerenza cross-page)

---

## 5. Sequenza implementazione

**Sprint 1 — Design System + Home**
1. Aggiungere token in `globals.css` (spacing, motion, surfaces, glow)
2. Creare `src/lib/motion.ts` con costanti TS
3. Aggiungere `.text-label`, `.text-mono` in `globals.css`
4. Applicare pattern section header uniforme in `app/[locale]/page.tsx`
5. Upgrade Hero (label tag, gap, CTA, image shadow)
6. Upgrade Trust Badges (testo, padding, hover)
7. Upgrade BentoItem (hover glow, label formato, prezzo monospace)
8. Sostituire delay CSS con Framer Motion variants + staggerChildren

**Sprint 2 — Product Page**
1. Gallery: thumbnail strip + AnimatePresence crossfade
2. Variant pills: glass effect + checkmark badge + stock badge esplicita
3. Pack selector: risparmio assoluto + prezzo barrato + hover
4. Add to cart: full-width upgrade + success state AnimatePresence
5. Feature cards: 2×2 left-aligned + icon compact

**Sprint 3 — Checkout**
1. Form fields: label upgrade + focus ring + validation icons inline
2. Free shipping bar: gradient + dot glow + percentuale + stato raggiunta
3. Promo code: monospace input + ghost CTA + success/error inline
4. Order summary: divider + totale monospace + trust line
5. Pay button: gradient overlay + loader + trust line
6. Cart items: badge glassmorphism + prezzo barrato + Rimuovi testo

---

## 6. Vincoli e non-scope

**Invariato per scelta:**
- Palette colori (tutte le variabili esistenti)
- Font families (Outfit + Cormorant Garamond)
- Grain texture overlay
- TiltCard, MagneticButton, SplitText (già funzionanti)
- ManifestoPinned scroll-driven
- Logica di business (cart, promo, shipping, Stripe)
- i18n (nessuna stringa UI modificata nel senso)
- Mobile swipe gallery (già implementato)
- Sticky CTA bar (già implementata)

**Non in scope:**
- Navigazione / Nav.tsx (non prioritario)
- Pagine categoria (tattoo/pmu/limited) — futura iterazione
- Pagina Sebo / Contatti / Pro
- SEO / metadata
- Performance / bundle size
- Dark/light mode toggle
