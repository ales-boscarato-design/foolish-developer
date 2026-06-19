# B2B Announcement Banner + Quote CTA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add (1) an announcement banner on the B2B catalog driven by a CMS collection Frank can update, linking to a `/offerte` detail page, and (2) a mailto quote-request CTA on every product card and product detail page.

**Architecture:** A new `Announcements` Payload collection holds one active announcement (title, teaser body, full content, optional date range). The B2B catalog page fetches it server-side and shows an `AnnouncementBanner` component when active. A static `/offerte` page renders the full content. The quote CTA is a pre-filled `mailto:wholesale@thefoolishbutcher.com` link rendered in `ProductCard` and the product detail page — no backend required.

**Tech Stack:** Payload CMS v3 (drizzle-postgres), Next.js 15, next-intl, React, CSS-in-JS (inline styles matching existing codebase patterns).

---

## Context for the implementer

This is a monorepo at `/home/ab/dev/foolish-storefront/` with:
- `cms/` — Payload CMS v3 admin (port 3001), PostgreSQL via drizzle-postgres, migrations in `cms/src/migrations/`
- `b2b/` — Next.js B2B portal (separate app), fetches from CMS REST API at `${CMS_URL}`

Key B2B patterns:
- Server components fetch from CMS at `${process.env.CMS_URL}/api/...`  
- Client components in `b2b/src/components/`, pages in `b2b/src/app/`
- All i18n strings live in `b2b/messages/{it,en,fr,es}.json`, accessed via `useTranslations('Namespace')` (client) or `getTranslations('Namespace')` (server)
- CSS is inline styles only — no Tailwind utility classes in JSX (they conflict with custom CSS in `globals.css`)
- Design tokens: `var(--background)` `var(--foreground)` `var(--accent)` `var(--muted-fg)` `var(--border)` `var(--card)` `var(--surface-2)` `var(--font-cormorant)` `var(--dur-fast)`
- Accent color: `#c8a97e` / `var(--accent)`. Background: `#080808`. Card: `#0f0f0f`

CMS migration format: look at `cms/src/migrations/20260619_150000_localize_reseller_description.ts` for the import/export pattern.

No tests exist in this codebase (zero test infrastructure). Skip all test steps — go straight to implementation and TypeScript typecheck as verification.

TypeScript check commands:
```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
```

---

## File Map

**Create:**
- `cms/src/collections/Announcements.ts` — Payload collection definition
- `cms/src/migrations/20260619_200000_create_announcements.ts` — SQL migration
- `b2b/src/components/AnnouncementBanner.tsx` — Banner card shown in catalog
- `b2b/src/app/offerte/page.tsx` — Full announcement detail page

**Modify:**
- `cms/src/payload.config.ts` — import + register Announcements collection
- `b2b/src/lib/cms.ts` — add `Announcement` type + `fetchActiveAnnouncement()`
- `b2b/src/app/catalogo/page.tsx` — fetch announcement + render banner
- `b2b/src/components/ProductCard.tsx` — add quote CTA link
- `b2b/src/app/catalogo/[slug]/page.tsx` — add quote CTA below add-to-cart
- `b2b/messages/it.json` — add new keys
- `b2b/messages/en.json` — add new keys
- `b2b/messages/fr.json` — add new keys
- `b2b/messages/es.json` — add new keys

---

## Task 1: Payload `Announcements` Collection + Migration

**Files:**
- Create: `cms/src/collections/Announcements.ts`
- Create: `cms/src/migrations/20260619_200000_create_announcements.ts`
- Modify: `cms/src/payload.config.ts`

- [ ] **Step 1: Create the Announcements collection**

```ts
// cms/src/collections/Announcements.ts
import type { CollectionConfig } from 'payload'

export const Announcements: CollectionConfig = {
  slug: 'announcements',
  admin: {
    useAsTitle: 'title',
    description: 'Annunci e comunicazioni per i rivenditori. Mantieni un solo annuncio attivo alla volta.',
    defaultColumns: ['title', 'active', 'startDate', 'endDate', 'updatedAt'],
    group: 'Marketing',
  },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Titolo (visibile nel banner)',
      admin: { description: 'Es. "Ordina entro il 31 luglio — consegna a settembre + 5% extra"' },
    },
    {
      name: 'body',
      type: 'textarea',
      label: 'Testo breve (banner)',
      admin: { description: '1–2 righe mostrate nel banner del catalogo.' },
    },
    {
      name: 'content',
      type: 'textarea',
      label: 'Contenuto completo (pagina /offerte)',
      admin: {
        description: 'Testo esteso della comunicazione: condizioni, date, pagamento anticipato, ecc. Vai a capo per separare i paragrafi.',
        rows: 12,
      },
    },
    {
      name: 'startDate',
      type: 'date',
      label: 'Data inizio visibilità',
      admin: { description: 'Lascia vuoto per mostrare subito.' },
    },
    {
      name: 'endDate',
      type: 'date',
      label: 'Data fine visibilità',
      admin: { description: 'Lascia vuoto per non scadere mai.' },
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      label: 'Attivo',
      admin: { description: 'Deve essere true perché il banner appaia.' },
    },
  ],
}
```

- [ ] **Step 2: Create the migration**

```ts
// cms/src/migrations/20260619_200000_create_announcements.ts
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "announcements" (
      "id" serial PRIMARY KEY NOT NULL,
      "title" varchar NOT NULL,
      "body" varchar,
      "content" varchar,
      "start_date" timestamp with time zone,
      "end_date" timestamp with time zone,
      "active" boolean DEFAULT false NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "announcements"`)
}
```

- [ ] **Step 3: Register the collection in payload.config.ts**

Read `cms/src/payload.config.ts`. Add the import after the existing imports:

```ts
import { Announcements } from './collections/Announcements'
```

Add `Announcements` to the `collections` array, after `OfferConfig`:

```ts
collections: [
  Products,
  Orders,
  Customers,
  Media,
  ProMembers,
  PromoCodes,
  CustomerFiles,
  PushSequences,
  OfferConfig,
  Announcements,   // ← add this
  {
    slug: 'users',
    // ...
  },
],
```

- [ ] **Step 4: TypeScript check CMS**

```bash
cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add cms/src/collections/Announcements.ts cms/src/migrations/20260619_200000_create_announcements.ts cms/src/payload.config.ts
git commit -m "feat(cms): Announcements collection per banner B2B"
```

---

## Task 2: B2B — `fetchActiveAnnouncement` + i18n keys

**Files:**
- Modify: `b2b/src/lib/cms.ts`
- Modify: `b2b/messages/it.json`
- Modify: `b2b/messages/en.json`
- Modify: `b2b/messages/fr.json`
- Modify: `b2b/messages/es.json`

- [ ] **Step 1: Add type + fetch function to `b2b/src/lib/cms.ts`**

Read the current file first. Append after the last export:

```ts
export interface Announcement {
  id: number
  title: string
  body?: string
  content?: string
  startDate?: string
  endDate?: string
}

export async function fetchActiveAnnouncement(): Promise<Announcement | null> {
  const now = new Date().toISOString()
  const url = `${CMS_URL}/api/announcements?where[active][equals]=true&sort=-updatedAt&limit=10`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const docs: Announcement[] = data.docs ?? []
    const valid = docs.find(doc => {
      const afterStart = !doc.startDate || doc.startDate <= now
      const beforeEnd = !doc.endDate || doc.endDate >= now
      return afterStart && beforeEnd
    })
    return valid ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Add i18n keys to `b2b/messages/it.json`**

Read the current file. Add the following new top-level namespaces and keys.

Inside `"Catalogo"`, add after the last key (`"info3Body2"`):
```json
"annuncio": "Comunicazione ai rivenditori",
"leggiOfferta": "Leggi i dettagli →"
```

Add new namespace `"Offerte"` at the end of the JSON (before the closing `}`):
```json
"Offerte": {
  "titolo": "Comunicazione ai rivenditori",
  "tornaCatalogo": "← Torna al catalogo",
  "nessunaOfferta": "Nessuna comunicazione attiva al momento.",
  "aggiornato": "Aggiornato il"
}
```

Inside `"ProductCard"`, add after `"finoA"`:
```json
"preventivo": "Chiedi preventivo"
```

Inside `"ProductPage"`, add after `"pz"`:
```json
"preventivo": "Chiedi preventivo personalizzato",
"preventivoDesc": "Per ordini maggiori o personalizzazioni"
```

- [ ] **Step 3: Add i18n keys to `b2b/messages/en.json`**

Same structure, with English values:

Inside `"Catalogo"`:
```json
"annuncio": "Reseller update",
"leggiOfferta": "Read full details →"
```

New namespace `"Offerte"`:
```json
"Offerte": {
  "titolo": "Reseller update",
  "tornaCatalogo": "← Back to catalogue",
  "nessunaOfferta": "No active update at the moment.",
  "aggiornato": "Updated on"
}
```

Inside `"ProductCard"`:
```json
"preventivo": "Request a quote"
```

Inside `"ProductPage"`:
```json
"preventivo": "Request a custom quote",
"preventivoDesc": "For larger orders or customisations"
```

- [ ] **Step 4: Add i18n keys to `b2b/messages/fr.json`**

Inside `"Catalogo"`:
```json
"annuncio": "Communication revendeurs",
"leggiOfferta": "Voir les détails →"
```

New namespace `"Offerte"`:
```json
"Offerte": {
  "titolo": "Communication revendeurs",
  "tornaCatalogo": "← Retour au catalogue",
  "nessunaOfferta": "Aucune communication active pour le moment.",
  "aggiornato": "Mis à jour le"
}
```

Inside `"ProductCard"`:
```json
"preventivo": "Demander un devis"
```

Inside `"ProductPage"`:
```json
"preventivo": "Demander un devis personnalisé",
"preventivoDesc": "Pour des commandes plus importantes ou des personnalisations"
```

- [ ] **Step 5: Add i18n keys to `b2b/messages/es.json`**

Inside `"Catalogo"`:
```json
"annuncio": "Comunicación a revendedores",
"leggiOfferta": "Ver detalles →"
```

New namespace `"Offerte"`:
```json
"Offerte": {
  "titolo": "Comunicación a revendedores",
  "tornaCatalogo": "← Volver al catálogo",
  "nessunaOfferta": "No hay comunicación activa en este momento.",
  "aggiornato": "Actualizado el"
}
```

Inside `"ProductCard"`:
```json
"preventivo": "Pedir presupuesto"
```

Inside `"ProductPage"`:
```json
"preventivo": "Pedir presupuesto personalizado",
"preventivoDesc": "Para pedidos mayores o personalizaciones"
```

- [ ] **Step 6: TypeCheck B2B**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/lib/cms.ts b2b/messages/it.json b2b/messages/en.json b2b/messages/fr.json b2b/messages/es.json
git commit -m "feat(b2b): fetchActiveAnnouncement e chiavi i18n per annunci e preventivo"
```

---

## Task 3: `AnnouncementBanner` Component

**Files:**
- Create: `b2b/src/components/AnnouncementBanner.tsx`

The banner must be a **server component** (no `'use client'`) since it receives already-fetched data. It accepts the announcement as a prop so the catalog page controls data fetching.

- [ ] **Step 1: Create `b2b/src/components/AnnouncementBanner.tsx`**

```tsx
// b2b/src/components/AnnouncementBanner.tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { Announcement } from '@/lib/cms'

interface Props {
  announcement: Announcement
}

export async function AnnouncementBanner({ announcement }: Props) {
  const t = await getTranslations('Catalogo')

  return (
    <div style={{
      background: 'rgba(200,169,126,0.08)',
      border: '1px solid rgba(200,169,126,0.3)',
      borderRadius: '1rem',
      padding: '1.25rem 1.5rem',
      marginBottom: '3rem',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '1rem',
    }}>
      {/* Icona / badge */}
      <span style={{
        flexShrink: 0,
        fontSize: '0.6rem',
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--accent)',
        fontWeight: 600,
        marginTop: '0.15rem',
        whiteSpace: 'nowrap',
      }}>
        ✦ {t('annuncio')}
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-cormorant)',
          fontStyle: 'italic',
          fontWeight: 600,
          fontSize: '1.1rem',
          color: 'var(--foreground)',
          marginBottom: announcement.body ? '0.4rem' : 0,
          lineHeight: 1.3,
        }}>
          {announcement.title}
        </p>
        {announcement.body && (
          <p style={{
            fontSize: '0.83rem',
            color: 'var(--muted-fg)',
            lineHeight: 1.65,
          }}>
            {announcement.body}
          </p>
        )}
      </div>

      {/* Link */}
      <Link
        href="/offerte"
        style={{
          flexShrink: 0,
          fontSize: '0.78rem',
          color: 'var(--accent)',
          textDecoration: 'none',
          fontWeight: 500,
          letterSpacing: '0.02em',
          whiteSpace: 'nowrap',
          alignSelf: 'center',
        }}
      >
        {t('leggiOfferta')}
      </Link>
    </div>
  )
}
```

- [ ] **Step 2: TypeCheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/components/AnnouncementBanner.tsx
git commit -m "feat(b2b): AnnouncementBanner component"
```

---

## Task 4: Wire Banner into Catalog Page

**Files:**
- Modify: `b2b/src/app/catalogo/page.tsx`

The catalog page already has `export const dynamic = 'force-dynamic'` and is a server component. Add the announcement fetch and render the banner just after the HERO section.

- [ ] **Step 1: Modify `b2b/src/app/catalogo/page.tsx`**

Read the current file. Make the following two changes:

**Add imports** at the top (after existing imports):
```tsx
import { fetchActiveAnnouncement } from '@/lib/cms'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
```

**Add fetch** inside `CatalogoPage()`, after `const t = await getTranslations('Catalogo')`:
```tsx
const announcement = await fetchActiveAnnouncement()
```

**Render banner** inside the returned JSX, as the very first child of the outer `<div>` (before the `{/* ── HERO ── */}` section):
```tsx
{announcement && <AnnouncementBanner announcement={announcement} />}
```

The full modified function signature and opening looks like:
```tsx
export default async function CatalogoPage() {
  const locale = await getLocale()
  const products = await fetchResellerProducts(locale)
  const t = await getTranslations('Catalogo')
  const announcement = await fetchActiveAnnouncement()

  return (
    <div>
      {announcement && <AnnouncementBanner announcement={announcement} />}

      {/* ── HERO ── */}
      <section style={{ marginBottom: '4rem', ... }}>
```

- [ ] **Step 2: TypeCheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/app/catalogo/page.tsx
git commit -m "feat(b2b): banner annuncio in cima alla pagina catalogo"
```

---

## Task 5: `/offerte` Detail Page

**Files:**
- Create: `b2b/src/app/offerte/page.tsx`

This is a server component page. It fetches the active announcement and renders its full `content` field. If no active announcement, shows a friendly empty state.

The `content` field is a plain textarea (newline-separated paragraphs). Render each line group as a `<p>` separated by blank lines — split on `\n\n` and render each chunk as a paragraph. Single newlines within a chunk render with `white-space: pre-line`.

- [ ] **Step 1: Create `b2b/src/app/offerte/page.tsx`**

```tsx
// b2b/src/app/offerte/page.tsx
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { fetchActiveAnnouncement } from '@/lib/cms'

export const dynamic = 'force-dynamic'

export default async function OffertePage() {
  const t = await getTranslations('Offerte')
  const announcement = await fetchActiveAnnouncement()

  if (!announcement) {
    return (
      <div style={{ maxWidth: '640px' }}>
        <Link href="/catalogo" style={{
          fontSize: '0.78rem', color: 'var(--muted-fg)', textDecoration: 'none',
          display: 'inline-block', marginBottom: '2rem',
        }}>
          {t('tornaCatalogo')}
        </Link>
        <p style={{ color: 'var(--muted-fg)', fontSize: '0.9rem' }}>{t('nessunaOfferta')}</p>
      </div>
    )
  }

  const paragraphs = (announcement.content ?? '').split(/\n\n+/).filter(Boolean)

  return (
    <div style={{ maxWidth: '640px' }}>
      <Link href="/catalogo" style={{
        fontSize: '0.78rem', color: 'var(--muted-fg)', textDecoration: 'none',
        display: 'inline-block', marginBottom: '2.5rem',
      }}>
        {t('tornaCatalogo')}
      </Link>

      <p style={{
        fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.18em',
        color: 'var(--accent)', marginBottom: '0.875rem',
      }}>
        ✦ {t('titolo')}
      </p>

      <h1 style={{
        fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
        fontSize: 'clamp(1.6rem, 4vw, 2.25rem)', lineHeight: 1.2,
        color: 'var(--foreground)', marginBottom: '2rem',
      }}>
        {announcement.title}
      </h1>

      {paragraphs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {paragraphs.map((para, i) => (
            <p key={i} style={{
              fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.8,
              whiteSpace: 'pre-line',
            }}>
              {para.trim()}
            </p>
          ))}
        </div>
      ) : announcement.body ? (
        <p style={{
          fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.8,
          whiteSpace: 'pre-line',
        }}>
          {announcement.body}
        </p>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: TypeCheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/app/offerte/page.tsx
git commit -m "feat(b2b): pagina /offerte per comunicazioni complete ai rivenditori"
```

---

## Task 6: Quote CTA in `ProductCard`

**Files:**
- Modify: `b2b/src/components/ProductCard.tsx`

Add a small "Chiedi preventivo" link at the bottom of each product card. The link uses `e.preventDefault()` + `e.stopPropagation()` to prevent the card's `Link` from intercepting the click, then opens the mailto URL.

Wait — the card is wrapped in a `<Link>`. A nested `<a>` (from mailto) inside a `<Link>` is invalid HTML. The correct approach: add an `onClick` interceptor on the card that handles the quote request, OR render the quote link outside the `<Link>` wrapper by restructuring the card.

Better approach: restructure the card so the outer `<Link>` does NOT wrap the entire card, but only the image + name area. The quote CTA becomes a sibling element in a column layout. But this would visually change the card.

Simplest valid approach that doesn't break anything: keep the card as a `<Link>` for the whole card, but add the quote link as a `<button>` (not `<a>`) inside the card that calls `window.open('mailto:...')` on click, with `e.stopPropagation()` to prevent the Link navigation.

Actually, even simpler: add the mailto as a `<a>` tag but since it's inside a Next.js `<Link>`, we need to call `e.stopPropagation()`. Next.js `<Link>` is `<a>` under the hood, and nested `<a>` is invalid. Use a `<button>` instead that calls `window.open`.

Here's the implementation:

- [ ] **Step 1: Modify `b2b/src/components/ProductCard.tsx`**

Read the current file. The card is currently `'use client'` and returns a `<Link>` wrapping the entire card div.

Inside the card's content `<div style={{ padding: '1rem' }}>`, after the existing discount badge `{maxDiscount > 0 && ...}`, add:

```tsx
<button
  onClick={e => {
    e.preventDefault()
    e.stopPropagation()
    const subject = encodeURIComponent(`Preventivo — ${product.name}`)
    const body = encodeURIComponent(`Salve,\n\nSono un rivenditore autorizzato di The Foolish Butcher e vorrei richiedere un preventivo per:\n\nProdotto: ${product.name}\nQuantità richiesta: \nNote / personalizzazioni: \n\nGrazie`)
    window.location.href = `mailto:wholesale@thefoolishbutcher.com?subject=${subject}&body=${body}`
  }}
  style={{
    display: 'block',
    marginTop: '0.75rem',
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontSize: '0.72rem',
    color: 'var(--muted-fg)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    letterSpacing: '0.02em',
    textAlign: 'left',
  }}
>
  {t('preventivo')}
</button>
```

- [ ] **Step 2: TypeCheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/components/ProductCard.tsx
git commit -m "feat(b2b): CTA preventivo su ogni product card"
```

---

## Task 7: Quote CTA on Product Detail Page

**Files:**
- Modify: `b2b/src/app/catalogo/[slug]/page.tsx`

The product detail page is a `'use client'` component. The product name is available as `product.name`. Add the quote CTA below the existing CTA div (after the `{/* CTA */}` block).

- [ ] **Step 1: Modify `b2b/src/app/catalogo/[slug]/page.tsx`**

Read the current file. Find the `{/* CTA */}` block. After its closing `</div>`, add:

```tsx
{/* Preventivo personalizzato */}
<div style={{ marginTop: '1rem' }}>
  <a
    href={`mailto:wholesale@thefoolishbutcher.com?subject=${encodeURIComponent(`Preventivo — ${product.name}`)}&body=${encodeURIComponent(`Salve,\n\nSono un rivenditore autorizzato di The Foolish Butcher e vorrei richiedere un preventivo per:\n\nProdotto: ${product.name}\nVariante: ${selectedVariant?.label ?? ''}\nQuantità richiesta: \nNote / personalizzazioni: \n\nGrazie`)}`}
    style={{
      fontSize: '0.78rem',
      color: 'var(--muted-fg)',
      textDecoration: 'underline',
      textUnderlineOffset: '2px',
      letterSpacing: '0.02em',
    }}
  >
    {t('preventivo')}
  </a>
  <span style={{ fontSize: '0.72rem', color: 'var(--muted-fg)', opacity: 0.6, marginLeft: '0.5rem' }}>
    — {t('preventivoDesc')}
  </span>
</div>
```

Note: `<a href="mailto:...">` is valid here because this is NOT inside a `<Link>` component. The product page's outer structure is a plain `<div>`.

- [ ] **Step 2: TypeCheck**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd /home/ab/dev/foolish-storefront
git add b2b/src/app/catalogo/[slug]/page.tsx
git commit -m "feat(b2b): CTA preventivo personalizzato nella pagina prodotto"
```

---

## Task 8: Final Push

- [ ] **Step 1: Full TypeCheck both apps**

```bash
cd /home/ab/dev/foolish-storefront/b2b && npx tsc --noEmit && cd ../cms && npx tsc --noEmit
```

Expected: no errors in either.

- [ ] **Step 2: Push to trigger Railway deploy**

```bash
cd /home/ab/dev/foolish-storefront
git push origin main
```

Expected: Railway deploys both CMS and B2B automatically.

---

## Self-Review

**Spec coverage:**
- ✅ Banner card in catalog, visible only when active announcement exists — Task 3 + 4
- ✅ Optional start/end dates for show/hide — Task 1 (fields) + Task 2 (date range check in `fetchActiveAnnouncement`)
- ✅ Frank can write via Payload REST API (collection has `read: () => true`, write requires `req.user` / Frank authenticates with his CMS credentials) — Task 1
- ✅ Banner links to detail page `/offerte` — Task 3 (Link href="/offerte") + Task 5
- ✅ `/offerte` renders full content with paragraphs, not just a list — Task 5
- ✅ "Chiedi preventivo personalizzato" CTA on product cards in catalog — Task 6
- ✅ "Chiedi preventivo personalizzato" CTA on product detail page — Task 7
- ✅ Mailto pre-fills product name + variant + blank fields for quantity/customization — Tasks 6 + 7
- ✅ Sends to `wholesale@thefoolishbutcher.com` — Tasks 6 + 7
- ✅ i18n in all 4 languages (it, en, fr, es) — Task 2
- ✅ Single active announcement at a time (date range + `active` flag filtering, returns first valid) — Task 2

**Placeholder scan:** No TBDs, TODOs, or vague steps. All code is complete.

**Type consistency:**
- `Announcement` interface defined in `cms.ts` (Task 2) used in `AnnouncementBanner.tsx` (Task 3) via `import type { Announcement } from '@/lib/cms'` ✅
- `fetchActiveAnnouncement()` returns `Promise<Announcement | null>` — used as such in catalog page and offerte page ✅
- `t('annuncio')` and `t('leggiOfferta')` in `AnnouncementBanner` — both added to all 4 locale files ✅
- `t('preventivo')` in `ProductCard` — added to all 4 locale files ✅
- `t('preventivo')` and `t('preventivoDesc')` in `[slug]/page.tsx` — added to all 4 locale files ✅
