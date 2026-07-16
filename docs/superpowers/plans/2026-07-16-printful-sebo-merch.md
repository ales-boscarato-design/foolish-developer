# Printful × SEBO Merch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendere merch SEBO (sticker, t-shirt) prodotto/spedito da Printful, sincronizzato manualmente in Payload, esposto in una galleria dentro `/sebo`, con fulfillment automatico verso Printful via un webhook Stripe indipendente.

**Architecture:** I prodotti merch sono `Products` Payload come tutti gli altri (nessuna nuova collection), con due campi tecnici in più per l'ID Printful. Un endpoint custom Payload + pulsante admin sincronizzano dati da Printful. La vetrina riusa `ProductCard`/`ProductDetail`/checkout esistenti. Un secondo webhook Stripe, completamente separato dal primo, inoltra a Printful solo le righe merch di un ordine.

**Tech Stack:** Next.js 15, Payload CMS 3.33, Postgres (push:false — ogni modifica di schema richiede una migration esplicita), Printful REST API v2 via `fetch` (nessun SDK ufficiale maturo, stesso approccio già usato per le altre integrazioni esterne di questo progetto).

## Global Constraints

- Riferimento: `docs/superpowers/specs/2026-07-16-printful-sebo-merch-design.md`.
- Nessun test runner in questo repo. Verifica con `npx tsc --noEmit` (storefront e cms) e, dove indicato, con verifica manuale via curl o browser. Non inventare mai output di comandi non eseguiti realmente.
- **`payload.config.ts` ha `push: false`**: qualunque cambio ai campi di una collection richiede una migration esplicita in `cms/src/migrations/` — lezione imparata a caro prezzo nel progetto abbonamento (una feature intera è arrivata in produzione senza tabelle perché questo passaggio era stato dimenticato). Non saltarlo.
- Questa è la prima volta che questo repo usa un **endpoint custom Payload** (`endpoints` a livello di collection) e un **componente custom nell'admin UI** (`admin.components`). Verifica la sintassi esatta contro i tipi reali installati (`node_modules/payload`) prima di scrivere il codice finale — non fidarti a memoria della sintassi Payload 2 vs 3, che differisce. Stesso approccio già usato con successo per i tipi Stripe nel progetto precedente: se il compilatore segnala un errore, leggi il tipo reale e allineati, non aggirare con `any`.
- L'integrazione Printful usa `fetch` diretto verso `https://api.printful.com/...` con header `Authorization: Bearer ${PRINTFUL_API_KEY}` — nessun SDK da installare.
- Non modificare `api/webhook/stripe/route.ts` esistente in nessun task — il nuovo webhook Printful è un file completamente separato.

---

## File Structure

**CMS (`cms/src/`):**
- `collections/Products.ts` — modificato. Nuova opzione `merch` in `section`, nuovi campi `printfulSyncProductId` e `variants[].printfulSyncVariantId`.
- `migrations/<data>_add_printful_fields.ts` — nuovo. Migration per i campi sopra.
- `endpoints/syncPrintful.ts` — nuovo. Handler dell'endpoint custom che chiama Printful e fa upsert dei `Products`.
- `components/SyncPrintfulButton.tsx` — nuovo. Bottone admin che chiama l'endpoint.

**Storefront (`storefront/src/`):**
- `lib/cms.ts` — modificato. `getProducts` accetta anche `'merch'`.
- `app/[locale]/sebo/page.tsx` — modificato. Nuova sezione galleria merch.
- `app/api/webhook/printful-fulfillment/route.ts` — nuovo. Webhook Stripe indipendente per il fulfillment Printful.

---

### Task 1: CMS — estendi `Products` con i campi Printful

**Files:**
- Modify: `cms/src/collections/Products.ts`

**Interfaces:**
- Produces: opzione `merch` in `Products.section`; campo `printfulSyncProductId` (text, top-level); campo `printfulSyncVariantId` (text) dentro ogni riga di `variants`. Usati dal Task 3 (sync) e Task 6 (webhook fulfillment).

- [ ] **Step 1: Trova il campo `section` e aggiungi l'opzione**

Nel blocco esistente (righe 37-46 circa):
```typescript
    {
      name: 'section',
      type: 'select',
      required: true,
      label: 'Sezione',
      options: [
        { label: 'Tattoo', value: 'tattoo' },
        { label: 'PMU (Permanent Make-up)', value: 'pmu' },
        { label: 'Kit rivenditori', value: 'kit' },
        { label: 'Merch SEBO', value: 'merch' },
      ],
    },
```

- [ ] **Step 2: Aggiungi `printfulSyncProductId` a livello prodotto**

Vicino al campo `slug` esistente, aggiungi:
```typescript
    {
      name: 'printfulSyncProductId',
      type: 'text',
      label: 'Printful Sync Product ID',
      admin: {
        description: 'ID del sync product Printful — compilato automaticamente dal pulsante di sincronizzazione, non modificare a mano.',
        condition: (data) => data.section === 'merch',
      },
    },
```

- [ ] **Step 3: Aggiungi `printfulSyncVariantId` dentro `variants`**

Trova il blocco `fields` del campo `variants` esistente (dove ci sono già `sku`, `label`, `price`, ecc.) e aggiungi una nuova riga:
```typescript
        {
          name: 'printfulSyncVariantId',
          type: 'text',
          label: 'Printful Sync Variant ID',
          admin: { description: 'ID della variante Printful corrispondente — compilato dal sync, non modificare a mano.' },
        },
```

- [ ] **Step 4: Rigenera i tipi e verifica**

Run: `cd cms && npm run generate:types && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add cms/src/collections/Products.ts cms/src/payload-types.ts
git commit -m "feat(cms): aggiungi campi Printful a Products (sezione merch)"
```

---

### Task 2: CMS — migration per i nuovi campi

**Files:**
- Create: `cms/src/migrations/20260716_120000_add_printful_fields.ts`
- Modify: `cms/src/migrations/index.ts`

**Interfaces:**
- Consumes: nessuno.
- Produces: colonne reali in Postgres per i campi del Task 1. **Obbligatorio** — `push: false` in `payload.config.ts` significa che senza questa migration i nuovi campi non esistono a livello di database e ogni lettura/scrittura fallirà silenziosamente o con errore SQL.

- [ ] **Step 1: Individua il nome esatto dell'enum e delle colonne esistenti**

Run: `grep -n "enum_products_section\|CREATE TYPE.*products_section" cms/src/migrations/*.ts`
Expected: trova la migration che ha creato `enum_products_section` originariamente (o l'ha estesa, es. `20260619_090000_add_kit_section.ts` per il valore `kit`) — usa lo stesso pattern `ALTER TYPE ... ADD VALUE IF NOT EXISTS` per aggiungere `merch`.

- [ ] **Step 2: Scrivi la migration**

```typescript
// cms/src/migrations/20260716_120000_add_printful_fields.ts
import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "public"."enum_products_section" ADD VALUE IF NOT EXISTS 'merch'`)
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "printful_sync_product_id" varchar`)
  await db.execute(sql`ALTER TABLE "products_variants" ADD COLUMN IF NOT EXISTS "printful_sync_variant_id" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products_variants" DROP COLUMN IF EXISTS "printful_sync_variant_id"`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "printful_sync_product_id"`)
  // Postgres non supporta la rimozione di un valore enum senza ricreare il tipo.
  // 'merch' resta in enum_products_section anche dopo il rollback.
}
```

Prima di considerarla definitiva, verifica con `\d products` e `\d products_variants` (o leggendo una migration precedente che tocca `products_variants`, es. `20260605_120000_fix_orders_array_column_names.ts` o simili) che i nomi delle tabelle/colonne reali corrispondano esattamente (Payload usa sempre snake_case: `products_variants` per l'array `variants` dentro `products`, non `product_variants`) — se il nome reale della tabella variants è diverso, correggi qui prima di procedere.

- [ ] **Step 3: Registra la migration in `index.ts`**

Segui esattamente il pattern delle migration esistenti: aggiungi l'import in cima e una entry nell'array `migrations` in fondo, con `name: '20260716_120000_add_printful_fields'`.

- [ ] **Step 4: Verifica di tipo**

Run: `cd cms && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add cms/src/migrations/20260716_120000_add_printful_fields.ts cms/src/migrations/index.ts
git commit -m "feat(cms): migration per campi Printful su Products"
```

Nota: questa migration va poi eseguita realmente contro il database di produzione (`npx payload migrate` con `DATABASE_URL` puntato al database reale) prima che la feature possa funzionare — stesso passaggio manuale già fatto per la feature abbonamento.

---

### Task 3: CMS — endpoint di sync Printful

**Files:**
- Create: `cms/src/endpoints/syncPrintful.ts`
- Modify: `cms/src/collections/Products.ts`

**Interfaces:**
- Consumes: `PRINTFUL_API_KEY` (env var, da aggiungere a `cms/.env.local`/Railway).
- Produces: `POST /api/products/sync-printful` (endpoint custom Payload) — crea/aggiorna `Products` con `section: 'merch'` a partire dal catalogo Printful. Chiamato dal Task 4 (bottone admin).

- [ ] **Step 1: Verifica la sintassi reale per gli `endpoints` custom su una collection Payload 3.33**

Run: `grep -rn "endpoints" node_modules/payload/dist/collections/config/types.d.ts | head -20`
Expected: conferma la forma esatta (tipicamente `{ path: string, method: 'get'|'post'|..., handler: (req: PayloadRequest) => Response | Promise<Response> }`). Se la forma reale differisce da quella usata sotto, adatta il codice a quella reale — non indovinare.

- [ ] **Step 2: Scrivi l'handler dell'endpoint**

```typescript
// cms/src/endpoints/syncPrintful.ts
import type { PayloadRequest } from 'payload'

interface PrintfulVariant {
  id: number
  name: string
  retail_price: string
  files: Array<{ type: string; preview_url?: string }>
}

interface PrintfulSyncProduct {
  id: number
  name: string
  thumbnail_url?: string
}

interface PrintfulListItem {
  sync_product: PrintfulSyncProduct
  sync_variants: PrintfulVariant[]
}

async function fetchPrintfulProducts(): Promise<PrintfulListItem[]> {
  const apiKey = process.env.PRINTFUL_API_KEY
  if (!apiKey) throw new Error('PRINTFUL_API_KEY non configurata')

  const listRes = await fetch('https://api.printful.com/store/products', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!listRes.ok) throw new Error(`Printful list failed: ${listRes.status}`)
  const listData = await listRes.json()

  const items: PrintfulListItem[] = []
  for (const item of listData.result as Array<{ id: number }>) {
    const detailRes = await fetch(`https://api.printful.com/store/products/${item.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!detailRes.ok) throw new Error(`Printful detail failed for ${item.id}: ${detailRes.status}`)
    const detail = await detailRes.json()
    items.push({ sync_product: detail.result.sync_product, sync_variants: detail.result.sync_variants })
  }
  return items
}

export async function syncPrintfulHandler(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const printfulProducts = await fetchPrintfulProducts()
    const results: Array<{ id: string; created: boolean; name: string }> = []

    for (const { sync_product, sync_variants } of printfulProducts) {
      const printfulSyncProductId = String(sync_product.id)

      const existing = await req.payload.find({
        collection: 'products',
        where: { printfulSyncProductId: { equals: printfulSyncProductId } },
        limit: 1,
        overrideAccess: true,
      })

      const variants = sync_variants.map((v) => ({
        sku: `PF-${v.id}`,
        label: v.name,
        price: parseFloat(v.retail_price),
        printfulSyncVariantId: String(v.id),
      }))

      if (existing.docs.length === 0) {
        const slug = `merch-${printfulSyncProductId}-${sync_product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
        const created = await req.payload.create({
          collection: 'products',
          data: {
            name: sync_product.name,
            slug,
            section: 'merch',
            active: false, // resta nascosto finché non completi manualmente descrizione/traduzioni
            printfulSyncProductId,
            variants,
            images: [], // le immagini Printful vanno caricate manualmente in Media — fuori scope l'auto-download
          },
          overrideAccess: true,
        })
        results.push({ id: String(created.id), created: true, name: sync_product.name })
      } else {
        const doc = existing.docs[0] as unknown as { id: string }
        await req.payload.update({
          collection: 'products',
          id: doc.id,
          data: { variants },
          overrideAccess: true,
        })
        results.push({ id: doc.id, created: false, name: sync_product.name })
      }
    }

    return Response.json({ ok: true, synced: results.length, results })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Sync fallito' }, { status: 500 })
  }
}
```

Nota: le immagini prodotto (`images` array, campo `upload` verso la collection `media`) **non vengono scaricate automaticamente da Printful** in questo step — richiederebbe scaricare il file remoto e ricrearlo come documento Payload Media, più complesso e fuori dallo scope dichiarato nella spec ("nessuna generazione/upload artwork automatico"). Il prodotto viene creato con `active: false` e `images: []` proprio perché richiede un intervento manuale (caricare almeno una foto, scrivere nome/descrizione) prima di renderlo visibile — coerente con la spec ("nome precompilato... descrizione vuota").

- [ ] **Step 3: Registra l'endpoint sulla collection**

In `cms/src/collections/Products.ts`, aggiungi l'import e il blocco `endpoints`:
```typescript
import { syncPrintfulHandler } from '../endpoints/syncPrintful'
```
Nell'oggetto `Products`, aggiungi (verifica il nome esatto della chiave — `endpoints` a livello di `CollectionConfig`, confermato allo Step 1):
```typescript
  endpoints: [
    {
      path: '/sync-printful',
      method: 'post',
      handler: syncPrintfulHandler,
    },
  ],
```

- [ ] **Step 4: Verifica di tipo**

Run: `cd cms && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Verifica manuale (richiede `PRINTFUL_API_KEY` reale in `cms/.env.local`)**

Con `cms` in dev (`npm run dev`) e un utente admin autenticato (sessione cookie), da un browser loggato nell'admin:
```bash
curl -X POST http://localhost:3001/api/products/sync-printful -H "Cookie: <cookie di sessione admin>"
```
Expected: `{"ok":true,"synced":N,"results":[...]}`. Se `PRINTFUL_API_KEY` non è disponibile in questo ambiente, salta questo step e segnalalo nel report invece di inventare un risultato.

- [ ] **Step 6: Commit**

```bash
git add cms/src/endpoints/syncPrintful.ts cms/src/collections/Products.ts
git commit -m "feat(cms): endpoint di sync prodotti Printful"
```

---

### Task 4: CMS — bottone admin "Sincronizza da Printful"

**Files:**
- Create: `cms/src/components/SyncPrintfulButton.tsx`
- Modify: `cms/src/collections/Products.ts`
- Modify: `cms/src/payload.config.ts` (solo se richiesto dalla sintassi reale — vedi Step 1)

**Interfaces:**
- Consumes: `POST /api/products/sync-printful` (Task 3).

- [ ] **Step 1: Verifica la sintassi reale per i componenti custom admin su una collection (Payload 3.33)**

Run: `grep -rn "beforeListTable\|beforeList\b" node_modules/payload/dist/admin/types.d.ts 2>/dev/null | head -10`

Payload 3 registra i componenti custom admin come stringhe di percorso file (risolte tramite un import map generato), non come riferimenti diretti al componente React. Verifica il formato esatto richiesto (es. se serve un file `cms/src/app/(payload)/admin/importMap.js` generato automaticamente, o se basta referenziare `'@/components/SyncPrintfulButton#SyncPrintfulButton'` in `admin.components.beforeListTable` della collection). Se la generazione dell'import map richiede un comando (`payload generate:importmap` o simile), eseguilo dopo aver aggiunto il componente. Adatta gli step seguenti alla sintassi reale trovata — non procedere a scrivere il resto se questa verifica dà esito ambiguo, riporta BLOCKED con quanto trovato.

- [ ] **Step 2: Scrivi il componente**

```typescript
// cms/src/components/SyncPrintfulButton.tsx
'use client'
import { useState } from 'react'

export function SyncPrintfulButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSync() {
    setStatus('loading')
    setMessage('')
    try {
      const res = await fetch('/api/products/sync-printful', { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Errore sconosciuto')
      setStatus('done')
      setMessage(`Sincronizzati ${data.synced} prodotti.`)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore sconosciuto')
    }
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <button
        onClick={handleSync}
        disabled={status === 'loading'}
        style={{
          padding: '8px 16px',
          borderRadius: '4px',
          border: '1px solid #333',
          background: status === 'loading' ? '#555' : '#000',
          color: '#fff',
          cursor: status === 'loading' ? 'default' : 'pointer',
        }}
      >
        {status === 'loading' ? 'Sincronizzazione...' : 'Sincronizza da Printful'}
      </button>
      {message && (
        <p style={{ marginTop: '8px', fontSize: '13px', color: status === 'error' ? '#c0392b' : '#2ecc71' }}>
          {message}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Registra il componente nella collection**

In `cms/src/collections/Products.ts`, dentro il blocco `admin` esistente, aggiungi (adattando alla sintassi confermata allo Step 1):
```typescript
    components: {
      beforeListTable: ['@/components/SyncPrintfulButton#SyncPrintfulButton'],
    },
```

- [ ] **Step 4: Verifica di tipo e build**

Run: `cd cms && npx tsc --noEmit`
Expected: nessun errore. Se Payload richiede una rigenerazione dell'import map, eseguila e committa anche il file generato.

- [ ] **Step 5: Verifica manuale**

Con `cms` in dev, apri `/admin/collections/products` da browser. Expected: il bottone "Sincronizza da Printful" appare sopra la tabella prodotti. Se non hai un browser disponibile in questo ambiente, salta questo step e segnalalo nel report.

- [ ] **Step 6: Commit**

```bash
git add cms/src/components/SyncPrintfulButton.tsx cms/src/collections/Products.ts
git commit -m "feat(cms): bottone admin per sincronizzazione Printful"
```

---

### Task 5: Storefront — galleria merch in `/sebo`

**Files:**
- Modify: `storefront/src/lib/cms.ts`
- Modify: `storefront/src/app/[locale]/sebo/page.tsx`

**Interfaces:**
- Consumes: `ProductCard` (componente esistente, prop `product: Product`), `getProducts` (da allargare).

- [ ] **Step 1: Allarga `getProducts`**

In `storefront/src/lib/cms.ts`, trova:
```typescript
export async function getProducts(section?: 'tattoo' | 'pmu', locale = 'it'): Promise<Product[]> {
```
Cambia la firma in:
```typescript
export async function getProducts(section?: 'tattoo' | 'pmu' | 'merch', locale = 'it'): Promise<Product[]> {
```
Nessun'altra modifica al corpo della funzione — usa già `section` come filtro generico.

- [ ] **Step 2: Aggiungi la sezione galleria nella pagina Sebo**

In `storefront/src/app/[locale]/sebo/page.tsx`, aggiungi gli import:
```typescript
import { getProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { getLocale } from 'next-intl/server'
```

Nella funzione `SeboPage`, dopo `const t = await getTranslations('sebo')`, aggiungi:
```typescript
  const locale = await getLocale()
  const merchProducts = await getProducts('merch', locale)
```

Inserisci la nuova sezione subito prima del blocco `{/* ── Il Pellaio cross-link ── */}` esistente (circa riga 189), solo se ci sono prodotti:
```typescript
      {merchProducts.length > 0 && (
        <section className="max-w-7xl mx-auto px-8 md:px-16 py-16 border-t" style={{ borderColor: '#1e1812' }}>
          <p className="text-xs uppercase tracking-widest mb-8" style={{ color: '#6b6055' }}>
            {t('merch.label')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {merchProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 3: Aggiungi la chiave di traduzione**

Nel blocco `sebo` esistente di ciascuno dei 5 file `storefront/messages/{it,en,de,fr,es}.json`, aggiungi la chiave `merch.label` con testo naturale (es. it: "Merch", o "Porta SEBO con te" — a scelta editoriale, coerente col tono sobrio già usato nel resto del blocco `sebo`).

- [ ] **Step 4: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/lib/cms.ts storefront/src/app/\[locale\]/sebo/page.tsx storefront/messages
git commit -m "feat(storefront): galleria merch SEBO nella pagina /sebo"
```

---

### Task 6: Storefront — webhook indipendente di fulfillment Printful

**Files:**
- Create: `storefront/src/app/api/webhook/printful-fulfillment/route.ts`

**Interfaces:**
- Consumes: `STRIPE_PRINTFUL_WEBHOOK_SECRET` (env var, nuova), `PRINTFUL_API_KEY` (env var, condivisa col Task 3).
- Produces: side effect su Printful (creazione ordine di produzione). Nessuna interazione con `api/webhook/stripe/route.ts` esistente.

- [ ] **Step 1: Scrivi il file**

```typescript
// storefront/src/app/api/webhook/printful-fulfillment/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

interface ParsedItem {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
}

interface MerchProductLookup {
  printfulSyncVariantId: string
}

async function findPrintfulVariantForSku(sku: string): Promise<string | null> {
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
  const res = await fetch(
    `${cmsUrl}/api/products?where[section][equals]=merch&where[variants.sku][equals]=${encodeURIComponent(sku)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' } },
  )
  if (!res.ok) return null
  const data = await res.json()
  const product = data.docs?.[0] as { variants?: Array<{ sku: string; printfulSyncVariantId?: string }> } | undefined
  const variant = product?.variants?.find((v) => v.sku === sku)
  return variant?.printfulSyncVariantId ?? null
}

async function createPrintfulOrder(params: {
  orderRef: string
  items: Array<{ variantId: string; quantity: number }>
  shipping: { name: string; address1: string; address2: string; city: string; postalCode: string; country: string }
}): Promise<void> {
  const apiKey = process.env.PRINTFUL_API_KEY
  if (!apiKey) throw new Error('PRINTFUL_API_KEY non configurata')

  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      external_id: params.orderRef,
      recipient: {
        name: params.shipping.name,
        address1: params.shipping.address1,
        address2: params.shipping.address2 || undefined,
        city: params.shipping.city,
        zip: params.shipping.postalCode,
        country_code: params.shipping.country,
      },
      items: params.items.map((i) => ({ sync_variant_id: Number(i.variantId), quantity: i.quantity })),
      confirm: true,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Printful create order failed ${res.status}: ${text}`)
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_PRINTFUL_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_PRINTFUL_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('Printful fulfillment webhook signature invalid:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }

    try {
      const meta = session.metadata ?? {}
      const orderRef = meta.order_ref ?? `FOOLISH-${session.id}`
      let parsedItems: ParsedItem[] = []
      try {
        parsedItems = JSON.parse(meta.items_json ?? '[]')
      } catch {
        return NextResponse.json({ received: true })
      }

      const merchItems: Array<{ variantId: string; quantity: number }> = []
      for (const item of parsedItems) {
        const variantId = await findPrintfulVariantForSku(item.sku)
        if (variantId) merchItems.push({ variantId, quantity: item.qty })
      }

      if (merchItems.length === 0) {
        return NextResponse.json({ received: true }) // nessuna riga merch in questo ordine
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shippingDetails = (session as any).shipping_details as {
        address?: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string }
      } | null
      const customerName = meta.customer_name ?? session.customer_details?.name ?? ''
      const shipping = {
        name: customerName,
        address1: shippingDetails?.address?.line1 ?? '',
        address2: shippingDetails?.address?.line2 ?? '',
        city: shippingDetails?.address?.city ?? '',
        postalCode: shippingDetails?.address?.postal_code ?? '',
        country: shippingDetails?.address?.country ?? '',
      }

      await createPrintfulOrder({ orderRef, items: merchItems, shipping })
      console.log(`[printful-webhook] Ordine Printful creato per ${orderRef} (${merchItems.length} righe)`)
    } catch (err) {
      console.error('[printful-webhook] Fulfillment failed:', err)
    }
  }

  return NextResponse.json({ received: true })
}
```

Nota su idempotenza: passiamo `external_id: orderRef` a Printful — l'API Printful rifiuta (o segnala) un secondo ordine con lo stesso `external_id` se già esistente, che è il meccanismo di idempotenza nativo di Printful per questo caso, invece di dover mantenere noi uno stato "già inviato" separato. Verifica questo comportamento nella documentazione Printful reale durante l'implementazione — se `external_id` non fornisce idempotenza nativa, aggiungi un controllo esplicito (es. un campo su Payload `Orders` per tracciare se il fulfillment Printful è già stato inoltrato) prima di procedere in produzione.

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore, no `any` oltre a quello già presente per `shipping_details` (stesso pattern già usato nel webhook esistente per lo stesso identico campo Stripe).

- [ ] **Step 3: Verifica manuale**

Se disponibili `PRINTFUL_API_KEY` e uno Stripe CLI autenticato, prova un evento di test come già fatto per la feature abbonamento (`stripe trigger checkout.session.completed`). Se non disponibili in questo ambiente, salta e segnala nel report.

- [ ] **Step 4: Commit**

```bash
git add storefront/src/app/api/webhook/printful-fulfillment/route.ts
git commit -m "feat(storefront): webhook indipendente fulfillment Printful per merch SEBO"
```

---

## Dopo l'ultimo task

1. Typecheck completo: `cd storefront && npx tsc --noEmit && cd ../cms && npx tsc --noEmit`.
2. Esegui la migration del Task 2 contro il database di produzione reale (`npx payload migrate` con `DATABASE_URL` corretto) — senza questo passaggio i nuovi campi non esistono in produzione, stesso errore già commesso nella feature abbonamento.
3. Aggiungi `PRINTFUL_API_KEY` alle variabili d'ambiente di entrambi i servizi Railway (`CMS` e `foolish-storefront`).
4. Registra su Stripe Dashboard il nuovo endpoint webhook `https://thefoolishbutcher.com/api/webhook/printful-fulfillment`, in ascolto su `checkout.session.completed`, e copia il signing secret generato in `STRIPE_PRINTFUL_WEBHOOK_SECRET` sul servizio storefront.
5. Crea/ottieni un `PRINTFUL_API_KEY` reale dal dashboard Printful (https://www.printful.com/dashboard/api).
6. Carica almeno un prodotto sync su Printful (fuori scope di questo piano — via dashboard Printful o tooling di Frank), poi premi "Sincronizza da Printful" in Payload admin, completa manualmente foto/nome/descrizione/traduzioni, attiva (`active: true`) e verifica che compaia in `/sebo`.
7. Test end-to-end: acquista un prodotto merch (anche in carrello misto con un prodotto Foolish) in Stripe test mode, verifica che l'ordine Printful venga creato correttamente e che l'ordine CMS normale non sia stato alterato.
8. Un solo `git push origin main` finale (regola del progetto).
