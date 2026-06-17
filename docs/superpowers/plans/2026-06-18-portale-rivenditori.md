# Portale Rivenditori Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire un portale B2B standalone (`rivenditori.thefoolishbutcher.com`) che permette ai rivenditori approvati di autenticarsi, vedere il catalogo con prezzi a volume, fare ordini con fattura e pagare tramite bonifico o Stripe (+4%).

**Architecture:** Nuovo servizio Next.js in `/b2b` (stesso monorepo, radice separata) connesso allo stesso CMS (`cms-production-1dda.up.railway.app`) e allo stesso DB (`DB_FOOLISH`). Il CMS esistente viene esteso con campi `resellerVisible` e `priceTiers` sui prodotti. Gli ordini vanno nella tabella `orders` esistente con `source = 'reseller'`. Zero impatto sul sito consumer finché non si fa `merge` su `main`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, `postgres` pkg per DB diretto, `jose` per JWT, Resend per email, Stripe 22 per pagamenti, zustand per stato carrello, Payload CMS REST API per prodotti.

---

## Mappa file

### CMS (modifiche)
| File | Azione |
|---|---|
| `cms/src/collections/Products.ts` | Aggiungi `resellerVisible` (checkbox) + `priceTiers` (array) |
| `cms/src/collections/Orders.ts` | Aggiungi `'reseller'` alle opzioni di `source` |

### B2B App (nuovo)
```
b2b/
├── Dockerfile
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── middleware.ts                          # protezione rotte
    ├── app/
    │   ├── layout.tsx
    │   ├── page.tsx                           # redirect a /catalogo o /login
    │   ├── login/page.tsx                     # form inserimento email
    │   ├── auth/verify/page.tsx               # landing link magico
    │   ├── catalogo/
    │   │   ├── page.tsx                       # lista prodotti rivenditori
    │   │   └── [slug]/page.tsx                # dettaglio prodotto + tabella fasce
    │   ├── carrello/page.tsx                  # carrello con prezzi tier
    │   ├── checkout/
    │   │   ├── page.tsx                       # form checkout + scelta pagamento
    │   │   └── conferma/page.tsx              # ordine confermato
    │   ├── account/page.tsx                   # storico ordini + profilo
    │   └── api/
    │       ├── auth/
    │       │   ├── magic-link/route.ts        # invia link magico
    │       │   ├── verify/route.ts            # verifica token → set cookie
    │       │   └── logout/route.ts            # cancella cookie
    │       ├── catalog/route.ts               # prodotti rivenditori (proxy CMS)
    │       ├── checkout/route.ts              # crea ordine (bonifico)
    │       ├── stripe/
    │       │   ├── create-intent/route.ts     # PaymentIntent con +4%
    │       │   └── webhook/route.ts           # conferma Stripe → ordine DB
    │       └── account/orders/route.ts        # storico ordini rivenditore
    ├── lib/
    │   ├── auth.ts          # JWT magic link + session
    │   ├── db.ts            # connessione postgres + query pro_members/orders
    │   ├── cms.ts           # fetch prodotti da CMS REST API
    │   ├── pricing.ts       # calcolo prezzo tier
    │   ├── cart.ts          # zustand store carrello
    │   └── resend.ts        # invio email
    └── components/
        ├── ProductCard.tsx
        ├── PriceTierTable.tsx
        ├── CartDrawer.tsx
        └── CheckoutForm.tsx
```

---

## Task 1: CMS — Estendi Products e Orders

**Files:**
- Modify: `cms/src/collections/Products.ts`
- Modify: `cms/src/collections/Orders.ts`

- [ ] **Step 1: Aggiungi campo `resellerVisible` e `priceTiers` a Products**

Apri `cms/src/collections/Products.ts`. Trova il campo `basePrice` e aggiungi dopo di esso (prima della chiusura dell'array `fields`):

```typescript
// dopo basePrice
{
  name: 'resellerVisible',
  type: 'checkbox',
  label: 'Visibile ai rivenditori',
  defaultValue: false,
  admin: {
    description: 'Mostra questo prodotto nel portale rivenditori',
    position: 'sidebar',
  },
},
{
  name: 'priceTiers',
  type: 'array',
  label: 'Fasce prezzo rivenditori',
  admin: {
    description: 'Sconto % per fascia di quantità. Lascia vuoto per non applicare sconti rivenditori.',
    condition: (data) => data.resellerVisible,
  },
  fields: [
    {
      name: 'minQty',
      type: 'number',
      label: 'Qtà minima',
      required: true,
      min: 1,
    },
    {
      name: 'maxQty',
      type: 'number',
      label: 'Qtà massima (lascia vuoto = illimitato)',
      min: 1,
    },
    {
      name: 'discountPercent',
      type: 'number',
      label: 'Sconto %',
      required: true,
      min: 0,
      max: 100,
    },
  ],
},
```

- [ ] **Step 2: Aggiungi `'reseller'` come source negli ordini**

Apri `cms/src/collections/Orders.ts`. Trova il campo `source` (select) e aggiungi l'opzione reseller:

```typescript
// nel campo source, aggiungi all'array options:
{ label: 'Rivenditore', value: 'reseller' },
```

- [ ] **Step 3: Genera migrazione Payload e deploya CMS**

```bash
cd cms
npm run payload migrate:create -- --name add-reseller-fields
# Payload genera il file in cms/src/migrations/
git add cms/src/migrations/ cms/src/collections/Products.ts cms/src/collections/Orders.ts
git commit -m "feat(cms): add resellerVisible, priceTiers on products; reseller source on orders"
git push origin feature/portale-rivenditori
```

Railway rideploya il CMS automaticamente ed esegue la migrazione.

- [ ] **Step 4: Verifica nel CMS admin**

Vai su `https://cms-production-1dda.up.railway.app/admin` → Products → apri un prodotto qualsiasi. Verifica che compaiano i campi "Visibile ai rivenditori" e "Fasce prezzo rivenditori".

- [ ] **Step 5: Configura 2-3 prodotti come visibili ai rivenditori**

Nel CMS admin:
- Spunta `resellerVisible: true` su 2-3 prodotti esistenti
- Aggiungi fasce di esempio:
  - minQty: 1, maxQty: 10, discountPercent: 10
  - minQty: 11, maxQty: 30, discountPercent: 15
  - minQty: 31, maxQty: null, discountPercent: 20
- Salva

- [ ] **Step 6: Verifica via API CMS**

```bash
curl "https://cms-production-1dda.up.railway.app/api/products?where[resellerVisible][equals]=true&depth=1" | python3 -m json.tool | head -60
```

Expected: lista prodotti con campo `priceTiers` valorizzato.

---

## Task 2: Scaffold B2B App

**Files:** Tutti i file di configurazione in `b2b/`

- [ ] **Step 1: Crea struttura directory**

```bash
mkdir -p b2b/src/{app/api,lib,components}
mkdir -p b2b/src/app/{login,auth/verify,catalogo,carrello,checkout/conferma,account}
mkdir -p b2b/src/app/api/{auth/{magic-link,verify,logout},catalog,checkout,stripe/{create-intent,webhook},account/orders}
touch b2b/src/app/catalogo/\[slug\]/.gitkeep
```

- [ ] **Step 2: Crea `b2b/package.json`**

```json
{
  "name": "foolish-b2b",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3002",
    "build": "next build",
    "start": "next start -p 3002"
  },
  "dependencies": {
    "next": "16.2.4",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "typescript": "^5",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "@tailwindcss/postcss": "^4",
    "jose": "^6.2.3",
    "postgres": "^3.4.9",
    "resend": "^6.12.4",
    "stripe": "^22.1.0",
    "@stripe/stripe-js": "^9.3.1",
    "zustand": "^5.0.12"
  }
}
```

- [ ] **Step 3: Crea `b2b/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Crea `b2b/next.config.ts`**

```typescript
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cms-production-1dda.up.railway.app' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ]
  },
}

export default nextConfig
```

- [ ] **Step 5: Crea `b2b/Dockerfile`**

```dockerfile
FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
RUN npm install

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3002
ENV PORT=3002
CMD ["node", "server.js"]
```

- [ ] **Step 6: Crea `b2b/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Foolish Butcher — Area Rivenditori',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="bg-stone-50 text-stone-900 min-h-screen font-sans antialiased">
        <header className="border-b border-stone-200 bg-white px-6 py-4 flex items-center justify-between">
          <span className="font-semibold tracking-tight">The Foolish Butcher — Rivenditori</span>
          <nav className="flex gap-4 text-sm">
            <a href="/catalogo" className="hover:underline">Catalogo</a>
            <a href="/carrello" className="hover:underline">Carrello</a>
            <a href="/account" className="hover:underline">Account</a>
            <a href="/api/auth/logout" className="text-stone-400 hover:underline">Esci</a>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>
      </body>
    </html>
  )
}
```

Crea anche `b2b/src/app/globals.css`:
```css
@import "tailwindcss";
```

- [ ] **Step 7: Crea `b2b/src/app/page.tsx`**

```tsx
import { redirect } from 'next/navigation'

export default function Home() {
  redirect('/catalogo')
}
```

- [ ] **Step 8: Crea `b2b/src/middleware.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const PUBLIC_PATHS = ['/login', '/auth/verify', '/api/auth/magic-link', '/api/auth/verify']
const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token = req.cookies.get('b2b_session')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  try {
    await jwtVerify(token, SESSION_SECRET)
    return NextResponse.next()
  } catch {
    const res = NextResponse.redirect(new URL('/login', req.url))
    res.cookies.delete('b2b_session')
    return res
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 9: Installa dipendenze e verifica compilazione**

```bash
cd b2b
npm install
npm run build
```

Expected: build completata senza errori TypeScript.

- [ ] **Step 10: Commit**

```bash
cd ..
git add b2b/
git commit -m "feat(b2b): scaffold Next.js app con layout, middleware, Dockerfile"
```

---

## Task 3: Core Libs (auth, db, cms, pricing, cart)

**Files:** Tutti i file in `b2b/src/lib/`

- [ ] **Step 1: Crea `b2b/src/lib/auth.ts`**

```typescript
import { SignJWT, jwtVerify } from 'jose'

const MAGIC_SECRET = new TextEncoder().encode(process.env.B2B_MAGIC_SECRET!)
const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)

export interface B2BSession {
  proMemberId: number
  email: string
  businessName: string
  contactName: string
  vatNumber: string
  status: 'active' | 'suspended'
}

export async function createMagicToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(MAGIC_SECRET)
}

export async function verifyMagicToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, MAGIC_SECRET)
    return payload.email as string
  } catch {
    return null
  }
}

export async function createSessionToken(session: B2BSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(SESSION_SECRET)
}

export async function verifySessionToken(token: string): Promise<B2BSession | null> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET)
    return payload as unknown as B2BSession
  } catch {
    return null
  }
}

export const SESSION_COOKIE = {
  name: 'b2b_session',
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  },
}
```

- [ ] **Step 2: Crea `b2b/src/lib/db.ts`**

```typescript
import postgres from 'postgres'

const sql = postgres(process.env.DATABASE_URL!, { max: 5 })

export default sql

export interface ProMember {
  id: number
  email: string
  business_name: string
  contact_name: string
  vat_number: string
  status: 'active' | 'suspended'
  discount_code: string
  total_spent: number
  order_count: number
}

export async function findProMemberByEmail(email: string): Promise<ProMember | null> {
  const rows = await sql<ProMember[]>`
    SELECT id, email, business_name, contact_name, vat_number, status, discount_code, total_spent, order_count
    FROM pro_members
    WHERE email = ${email}
    LIMIT 1
  `
  return rows[0] ?? null
}

export interface ResellerOrder {
  id: number
  order_number: string
  total: number
  pipeline_state: string
  created_at: Date
  tracking_number: string | null
  payment_method: string | null
}

export async function getResellerOrders(email: string): Promise<ResellerOrder[]> {
  return sql<ResellerOrder[]>`
    SELECT id, order_number, total, pipeline_state, created_at, tracking_number, notes
    FROM orders
    WHERE customer_email = ${email}
      AND source = 'reseller'
    ORDER BY created_at DESC
    LIMIT 50
  `
}

export interface CreateOrderInput {
  orderNumber: string
  customerEmail: string
  customerName: string
  vatNumber: string
  businessName: string
  sdiCode: string
  billingAddress1: string
  billingCity: string
  billingPostalCode: string
  billingCountry: string
  shippingAddressName: string
  shippingAddress1: string
  shippingCity: string
  shippingPostalCode: string
  shippingCountry: string
  lineItems: object
  total: number
  shippingCost: number
  paymentMethod: string
  notes?: string
}

export async function createResellerOrder(input: CreateOrderInput): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO orders (
      order_number, customer_email, customer_name, source,
      billing_vat_number, billing_company_name, billing_sdi_code,
      billing_address_name, billing_address_address1, billing_address_city,
      billing_address_postal_code, billing_address_country,
      shipping_address_name, shipping_address_address1, shipping_address_city,
      shipping_address_postal_code, shipping_address_country,
      line_items, total, shipping_cost, notes, pipeline_state,
      updated_at, created_at
    ) VALUES (
      ${input.orderNumber}, ${input.customerEmail}, ${input.customerName}, 'reseller',
      ${input.vatNumber}, ${input.businessName}, ${input.sdiCode},
      ${input.businessName}, ${input.billingAddress1}, ${input.billingCity},
      ${input.billingPostalCode}, ${input.billingCountry},
      ${input.shippingAddressName}, ${input.shippingAddress1}, ${input.shippingCity},
      ${input.shippingPostalCode}, ${input.shippingCountry},
      ${JSON.stringify(input.lineItems)}, ${input.total}, ${input.shippingCost},
      ${input.notes ?? `Pagamento: ${input.paymentMethod}`}, 'received',
      NOW(), NOW()
    )
    RETURNING id
  `
  return rows[0].id
}
```

- [ ] **Step 3: Crea `b2b/src/lib/cms.ts`**

```typescript
const CMS_URL = process.env.CMS_URL!

export interface PriceTier {
  minQty: number
  maxQty: number | null
  discountPercent: number
}

export interface ProductVariant {
  id: string
  sku: string
  label: string
  price: number
}

export interface ResellerProduct {
  id: number
  slug: string
  name: string
  basePrice: number
  priceTiers: PriceTier[]
  variants: ProductVariant[]
  images: { url: string; alt?: string }[]
  description?: string
}

export async function fetchResellerProducts(): Promise<ResellerProduct[]> {
  const url = `${CMS_URL}/api/products?where[resellerVisible][equals]=true&depth=1&limit=100`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`CMS error: ${res.status}`)
  const data = await res.json()
  return data.docs as ResellerProduct[]
}

export async function fetchResellerProductBySlug(slug: string): Promise<ResellerProduct | null> {
  const url = `${CMS_URL}/api/products?where[slug][equals]=${slug}&where[resellerVisible][equals]=true&depth=1&limit=1`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) return null
  const data = await res.json()
  return data.docs[0] ?? null
}
```

- [ ] **Step 4: Crea `b2b/src/lib/pricing.ts`**

```typescript
import type { PriceTier } from './cms'

/**
 * Calcola il prezzo unitario scontato per una variante dato il numero di pezzi.
 * Se nessuna fascia corrisponde, ritorna il prezzo base.
 */
export function calculateUnitPrice(basePrice: number, qty: number, tiers: PriceTier[]): number {
  if (!tiers || tiers.length === 0) return basePrice
  const tier = tiers.find(
    t => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty)
  )
  if (!tier) return basePrice
  return basePrice * (1 - tier.discountPercent / 100)
}

export function calculateLineTotal(basePrice: number, qty: number, tiers: PriceTier[]): number {
  return calculateUnitPrice(basePrice, qty, tiers) * qty
}

export function formatPrice(eur: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(eur)
}

/** Determina la fascia attiva per una certa quantità */
export function getActiveTier(qty: number, tiers: PriceTier[]): PriceTier | null {
  return tiers.find(t => qty >= t.minQty && (t.maxQty === null || qty <= t.maxQty)) ?? null
}
```

- [ ] **Step 5: Testa la logica pricing (verifica manuale)**

```bash
cd b2b
node -e "
const { calculateUnitPrice, calculateLineTotal } = require('./src/lib/pricing.ts')
// Con tiers: [{1,10,10%}, {11,30,15%}, {31,null,20%}]
const tiers = [
  {minQty:1, maxQty:10, discountPercent:10},
  {minQty:11, maxQty:30, discountPercent:15},
  {minQty:31, maxQty:null, discountPercent:20},
]
console.log(calculateUnitPrice(100, 5, tiers))   // expected: 90
console.log(calculateUnitPrice(100, 15, tiers))  // expected: 85
console.log(calculateUnitPrice(100, 50, tiers))  // expected: 80
console.log(calculateLineTotal(100, 5, tiers))   // expected: 450
"
```

Nota: se il runner non supporta TS direttamente, verifica manualmente aprendo il browser su /catalogo dopo il deploy locale.

- [ ] **Step 6: Crea `b2b/src/lib/cart.ts`**

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PriceTier } from './cms'
import { calculateLineTotal } from './pricing'

export interface CartItem {
  productId: number
  productSlug: string
  productName: string
  variantSku: string
  variantLabel: string
  unitPrice: number   // prezzo base variante
  qty: number
  priceTiers: PriceTier[]
}

interface CartStore {
  items: CartItem[]
  addItem: (item: CartItem) => void
  updateQty: (sku: string, qty: number) => void
  removeItem: (sku: string) => void
  clear: () => void
  total: () => number
  itemCount: () => number
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => set(state => {
        const existing = state.items.find(i => i.variantSku === item.variantSku)
        if (existing) {
          return {
            items: state.items.map(i =>
              i.variantSku === item.variantSku
                ? { ...i, qty: i.qty + item.qty }
                : i
            ),
          }
        }
        return { items: [...state.items, item] }
      }),

      updateQty: (sku, qty) => set(state => ({
        items: qty <= 0
          ? state.items.filter(i => i.variantSku !== sku)
          : state.items.map(i => i.variantSku === sku ? { ...i, qty } : i),
      })),

      removeItem: (sku) => set(state => ({
        items: state.items.filter(i => i.variantSku !== sku),
      })),

      clear: () => set({ items: [] }),

      total: () => get().items.reduce(
        (sum, item) => sum + calculateLineTotal(item.unitPrice, item.qty, item.priceTiers),
        0
      ),

      itemCount: () => get().items.reduce((sum, item) => sum + item.qty, 0),
    }),
    { name: 'b2b-cart' }
  )
)
```

- [ ] **Step 7: Crea `b2b/src/lib/resend.ts`**

```typescript
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM = 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'

export async function sendMagicLink(email: string, link: string, contactName: string) {
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Accesso area rivenditori — The Foolish Butcher',
    html: `
      <p>Ciao ${contactName},</p>
      <p>Clicca il link per accedere all'area rivenditori (valido 15 minuti):</p>
      <p><a href="${link}" style="background:#1c1c1c;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Accedi all'area rivenditori</a></p>
      <p style="color:#888;font-size:12px">Se non hai richiesto questo accesso, ignora questa email.</p>
    `,
  })
}

export async function sendOrderConfirmation(params: {
  email: string
  contactName: string
  orderNumber: string
  total: number
  paymentMethod: string
  lineItems: { name: string; qty: number; total: number }[]
}) {
  const itemsHtml = params.lineItems
    .map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>€${i.total.toFixed(2)}</td></tr>`)
    .join('')

  const paymentNote = params.paymentMethod === 'bonifico'
    ? `<p><strong>Pagamento:</strong> Bonifico bancario. Riceverai le coordinate bancarie a breve via email.</p>`
    : `<p><strong>Pagamento:</strong> Carta di credito (Stripe). Il pagamento è stato confermato.</p>`

  await resend.emails.send({
    from: FROM,
    to: params.email,
    subject: `Ordine ${params.orderNumber} confermato — The Foolish Butcher`,
    html: `
      <p>Ciao ${params.contactName},</p>
      <p>Il tuo ordine <strong>${params.orderNumber}</strong> è stato ricevuto.</p>
      <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
        <thead><tr><th>Prodotto</th><th>Qtà</th><th>Totale</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p><strong>Totale ordine: €${params.total.toFixed(2)}</strong> (IVA inclusa)</p>
      ${paymentNote}
      <p>Grazie,<br/>The Foolish Butcher</p>
    `,
  })
}
```

- [ ] **Step 8: Commit**

```bash
git add b2b/src/lib/
git commit -m "feat(b2b): add auth, db, cms, pricing, cart, resend libs"
```

---

## Task 4: Auth ProMember (magic link)

**Files:**
- Create: `b2b/src/app/api/auth/magic-link/route.ts`
- Create: `b2b/src/app/api/auth/verify/route.ts`
- Create: `b2b/src/app/api/auth/logout/route.ts`
- Create: `b2b/src/app/login/page.tsx`
- Create: `b2b/src/app/auth/verify/page.tsx`

- [ ] **Step 1: Crea `b2b/src/app/api/auth/magic-link/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { findProMemberByEmail } from '@/lib/db'
import { createMagicToken } from '@/lib/auth'
import { sendMagicLink } from '@/lib/resend'

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email richiesta' }, { status: 400 })
  }

  const member = await findProMemberByEmail(email.toLowerCase().trim())

  // Risposta identica sia per email trovate che non (sicurezza)
  if (!member || member.status !== 'active') {
    return NextResponse.json({ ok: true })
  }

  const token = await createMagicToken(email)
  const baseUrl = process.env.NEXT_PUBLIC_URL ?? 'https://rivenditori.thefoolishbutcher.com'
  const link = `${baseUrl}/auth/verify?token=${token}`

  await sendMagicLink(email, link, member.contact_name)

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Crea `b2b/src/app/api/auth/verify/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { findProMemberByEmail } from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid', req.url))
  }

  const email = await verifyMagicToken(token)
  if (!email) {
    return NextResponse.redirect(new URL('/login?error=expired', req.url))
  }

  const member = await findProMemberByEmail(email)
  if (!member || member.status !== 'active') {
    return NextResponse.redirect(new URL('/login?error=unauthorized', req.url))
  }

  const sessionToken = await createSessionToken({
    proMemberId: member.id,
    email: member.email,
    businessName: member.business_name,
    contactName: member.contact_name,
    vatNumber: member.vat_number,
    status: member.status,
  })

  const res = NextResponse.redirect(new URL('/catalogo', req.url))
  res.cookies.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)
  return res
}
```

- [ ] **Step 3: Crea `b2b/src/app/api/auth/logout/route.ts`**

```typescript
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

export async function GET() {
  const res = NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_URL ?? 'https://rivenditori.thefoolishbutcher.com')
  )
  res.cookies.delete(SESSION_COOKIE.name)
  return res
}
```

- [ ] **Step 4: Crea `b2b/src/app/login/page.tsx`**

```tsx
'use client'
import { useState } from 'react'

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string }
}) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const errorMessages: Record<string, string> = {
    invalid: 'Link non valido.',
    expired: 'Link scaduto. Richiedi un nuovo accesso.',
    unauthorized: 'Account non autorizzato o sospeso.',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <h1 className="text-2xl font-semibold mb-2">Area Rivenditori</h1>
      <p className="text-stone-500 mb-8 text-sm">
        Inserisci la tua email per ricevere il link di accesso.
      </p>

      {searchParams.error && (
        <p className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded mb-4">
          {errorMessages[searchParams.error] ?? 'Errore sconosciuto.'}
        </p>
      )}

      {sent ? (
        <div className="bg-green-50 text-green-700 px-4 py-3 rounded text-sm">
          ✓ Se l'email è registrata, riceverai il link entro pochi secondi.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            required
            placeholder="email@azienda.it"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="border border-stone-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-stone-900 text-white rounded px-4 py-2 text-sm hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? 'Invio...' : 'Ricevi link di accesso'}
          </button>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Crea `b2b/src/app/auth/verify/page.tsx`**

```tsx
export default function VerifyPage() {
  return (
    <div className="max-w-sm mx-auto mt-20 text-center">
      <p className="text-stone-500">Verifica in corso...</p>
    </div>
  )
}
```

Nota: il middleware reindirizza al verify API route prima di mostrare questa pagina. La pagina è un placeholder visivo per il momento di transizione.

- [ ] **Step 6: Aggiorna middleware per redirigere `/auth/verify` all'API**

Il link magico punta a `/auth/verify?token=...` (pagina) ma il lavoro lo fa l'API. Dobbiamo fare in modo che la pagina `/auth/verify` esegua la verifica server-side. Modifica `b2b/src/app/auth/verify/page.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default function VerifyPage({
  searchParams,
}: {
  searchParams: { token?: string }
}) {
  if (searchParams.token) {
    redirect(`/api/auth/verify?token=${searchParams.token}`)
  }
  redirect('/login?error=invalid')
}
```

- [ ] **Step 7: Verifica flusso auth in locale**

```bash
cd b2b
# Crea .env.local con le variabili minime
cat > .env.local << 'EOF'
B2B_MAGIC_SECRET=test-magic-secret-dev-32chars-min
B2B_SESSION_SECRET=test-session-secret-dev-32chars
DATABASE_URL=postgresql://postgres:yRvHQCeRpKZDXlURNKNCFKdWEmwTPeyi@junction.proxy.rlwy.net:18293/railway
CMS_URL=https://cms-production-1dda.up.railway.app
RESEND_API_KEY=re_REDACTED
NEXT_PUBLIC_URL=http://localhost:3002
EOF

npm run dev
```

Apri `http://localhost:3002/login`, inserisci l'email di un ProMember attivo (es. `erikalomino979@gmail.com`), controlla che arrivi l'email con il link, clicca il link e verifica il redirect a `/catalogo`.

- [ ] **Step 8: Commit**

```bash
git add b2b/src/app/login b2b/src/app/auth b2b/src/app/api/auth b2b/.env.local.example
git commit -m "feat(b2b): magic link auth per ProMembers"
```

---

## Task 5: Catalogo Prodotti

**Files:**
- Create: `b2b/src/app/catalogo/page.tsx`
- Create: `b2b/src/app/catalogo/[slug]/page.tsx`
- Create: `b2b/src/components/ProductCard.tsx`
- Create: `b2b/src/components/PriceTierTable.tsx`

- [ ] **Step 1: Crea `b2b/src/components/PriceTierTable.tsx`**

```tsx
import type { PriceTier } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'

interface Props {
  tiers: PriceTier[]
  basePrice: number
  currentQty?: number
}

export function PriceTierTable({ tiers, basePrice, currentQty = 0 }: Props) {
  if (!tiers || tiers.length === 0) return null

  return (
    <div className="mt-4">
      <p className="text-xs text-stone-500 uppercase tracking-wide mb-2">Prezzi a volume</p>
      <table className="w-full text-sm border border-stone-200 rounded overflow-hidden">
        <thead className="bg-stone-100">
          <tr>
            <th className="text-left px-3 py-2">Quantità</th>
            <th className="text-left px-3 py-2">Sconto</th>
            <th className="text-right px-3 py-2">Prezzo/pz</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => {
            const isActive = currentQty >= tier.minQty && (tier.maxQty === null || currentQty <= tier.maxQty)
            const discountedPrice = basePrice * (1 - tier.discountPercent / 100)
            const label = tier.maxQty ? `${tier.minQty}–${tier.maxQty} pz` : `${tier.minQty}+ pz`
            return (
              <tr
                key={i}
                className={isActive ? 'bg-green-50 font-medium' : 'border-t border-stone-100'}
              >
                <td className="px-3 py-2">{label}</td>
                <td className="px-3 py-2 text-green-700">-{tier.discountPercent}%</td>
                <td className="px-3 py-2 text-right">{formatPrice(discountedPrice)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Crea `b2b/src/components/ProductCard.tsx`**

```tsx
import Link from 'next/link'
import type { ResellerProduct } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'

interface Props {
  product: ResellerProduct
}

export function ProductCard({ product }: Props) {
  const image = product.images?.[0]
  const minTierDiscount = product.priceTiers?.length
    ? Math.max(...product.priceTiers.map(t => t.discountPercent))
    : 0

  return (
    <Link href={`/catalogo/${product.slug}`} className="group block border border-stone-200 rounded-lg overflow-hidden hover:border-stone-400 transition-colors">
      {image && (
        <div className="aspect-square bg-stone-100 overflow-hidden">
          <img
            src={`${process.env.NEXT_PUBLIC_CMS_URL}${image.url}`}
            alt={image.alt ?? product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        </div>
      )}
      <div className="p-4">
        <h2 className="font-medium text-sm">{product.name}</h2>
        <p className="text-stone-500 text-xs mt-1">
          Da {formatPrice(product.variants?.[0]?.price ?? product.basePrice)}/pz
        </p>
        {minTierDiscount > 0 && (
          <span className="inline-block mt-2 bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded">
            Fino a -{minTierDiscount}%
          </span>
        )}
      </div>
    </Link>
  )
}
```

- [ ] **Step 3: Crea `b2b/src/app/catalogo/page.tsx`**

```tsx
import { fetchResellerProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export const revalidate = 60

export default async function CatalogoPage() {
  const products = await fetchResellerProducts()

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Catalogo Rivenditori</h1>
      {products.length === 0 ? (
        <p className="text-stone-400">Nessun prodotto disponibile al momento.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {products.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Crea `b2b/src/app/catalogo/[slug]/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ResellerProduct, ProductVariant } from '@/lib/cms'
import { calculateUnitPrice, calculateLineTotal, formatPrice } from '@/lib/pricing'
import { PriceTierTable } from '@/components/PriceTierTable'
import { useCart } from '@/lib/cart'

export default function ProductPage({ params }: { params: { slug: string } }) {
  const [product, setProduct] = useState<ResellerProduct | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const { addItem } = useCart()
  const router = useRouter()

  useEffect(() => {
    fetch(`/api/catalog?slug=${params.slug}`)
      .then(r => r.json())
      .then(data => {
        setProduct(data)
        setSelectedVariant(data?.variants?.[0] ?? null)
      })
  }, [params.slug])

  if (!product) return <p className="text-stone-400">Caricamento...</p>

  const tiers = product.priceTiers ?? []
  const basePrice = selectedVariant?.price ?? product.basePrice
  const unitPrice = calculateUnitPrice(basePrice, qty, tiers)
  const lineTotal = calculateLineTotal(basePrice, qty, tiers)

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
    <div className="max-w-2xl">
      <button onClick={() => router.back()} className="text-sm text-stone-400 mb-6 hover:underline">
        ← Torna al catalogo
      </button>

      <h1 className="text-2xl font-semibold mb-2">{product.name}</h1>

      {/* Selezione variante */}
      {product.variants && product.variants.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm text-stone-500 mb-2">Formato</label>
          <div className="flex gap-2 flex-wrap">
            {product.variants.map(v => (
              <button
                key={v.sku}
                onClick={() => setSelectedVariant(v)}
                className={`border rounded px-3 py-1.5 text-sm transition-colors ${
                  selectedVariant?.sku === v.sku
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 hover:border-stone-500'
                }`}
              >
                {v.label} — {formatPrice(v.price)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quantità + prezzo dinamico */}
      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm text-stone-500">Quantità</label>
        <div className="flex items-center border border-stone-300 rounded">
          <button onClick={() => setQty(q => Math.max(1, q - 1))} className="px-3 py-1 text-lg">−</button>
          <span className="px-4 text-sm">{qty}</span>
          <button onClick={() => setQty(q => q + 1)} className="px-3 py-1 text-lg">+</button>
        </div>
        <div className="text-sm">
          <span className="text-stone-500">Prezzo/pz: </span>
          <span className="font-medium">{formatPrice(unitPrice)}</span>
          {unitPrice < basePrice && (
            <span className="text-stone-400 line-through ml-2">{formatPrice(basePrice)}</span>
          )}
        </div>
      </div>

      <PriceTierTable tiers={tiers} basePrice={basePrice} currentQty={qty} />

      <div className="mt-6 flex items-center gap-4">
        <div className="text-lg font-semibold">Totale: {formatPrice(lineTotal)}</div>
        <button
          onClick={handleAdd}
          className="bg-stone-900 text-white px-6 py-2 rounded text-sm hover:bg-stone-700 transition-colors"
        >
          {added ? '✓ Aggiunto' : 'Aggiungi al carrello'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Crea `b2b/src/app/api/catalog/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { fetchResellerProducts, fetchResellerProductBySlug } from '@/lib/cms'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')

  if (slug) {
    const product = await fetchResellerProductBySlug(slug)
    if (!product) return NextResponse.json(null, { status: 404 })
    return NextResponse.json(product)
  }

  const products = await fetchResellerProducts()
  return NextResponse.json(products)
}
```

- [ ] **Step 6: Verifica in locale**

```bash
# con il server già avviato (npm run dev in b2b/)
# vai su http://localhost:3002/catalogo
# verifica che i prodotti con resellerVisible=true appaiano
# clicca su un prodotto → verifica tabella fasce prezzo
# cambia quantità → verifica che prezzo/pz e totale si aggiornino
# verifica che la fascia attiva sia evidenziata in verde
```

- [ ] **Step 7: Commit**

```bash
git add b2b/src/app/catalogo b2b/src/app/api/catalog b2b/src/components/
git commit -m "feat(b2b): catalogo prodotti con fasce prezzo a volume"
```

---

## Task 6: Carrello

**Files:**
- Create: `b2b/src/app/carrello/page.tsx`

- [ ] **Step 1: Crea `b2b/src/app/carrello/page.tsx`**

```tsx
'use client'
import { useCart } from '@/lib/cart'
import { calculateLineTotal, formatPrice } from '@/lib/pricing'
import Link from 'next/link'

export default function CarrelloPage() {
  const { items, updateQty, removeItem, total } = useCart()

  if (items.length === 0) {
    return (
      <div className="text-center mt-20">
        <p className="text-stone-400 mb-4">Il carrello è vuoto.</p>
        <Link href="/catalogo" className="text-sm underline">Torna al catalogo</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Carrello</h1>

      <div className="divide-y divide-stone-100">
        {items.map(item => {
          const lineTotal = calculateLineTotal(item.unitPrice, item.qty, item.priceTiers)
          return (
            <div key={item.variantSku} className="py-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium text-sm">{item.productName}</p>
                <p className="text-stone-400 text-xs">{item.variantLabel}</p>
              </div>
              <div className="flex items-center border border-stone-200 rounded">
                <button
                  onClick={() => updateQty(item.variantSku, item.qty - 1)}
                  className="px-2 py-1"
                >−</button>
                <span className="px-3 text-sm">{item.qty}</span>
                <button
                  onClick={() => updateQty(item.variantSku, item.qty + 1)}
                  className="px-2 py-1"
                >+</button>
              </div>
              <div className="text-sm font-medium w-20 text-right">{formatPrice(lineTotal)}</div>
              <button
                onClick={() => removeItem(item.variantSku)}
                className="text-stone-300 hover:text-red-400 text-xs"
              >✕</button>
            </div>
          )
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-stone-200 flex items-center justify-between">
        <div>
          <p className="text-sm text-stone-500">Totale (IVA inclusa)</p>
          <p className="text-2xl font-semibold">{formatPrice(total())}</p>
          <p className="text-xs text-stone-400 mt-1">+ spedizione calcolata al checkout</p>
        </div>
        <Link
          href="/checkout"
          className="bg-stone-900 text-white px-8 py-3 rounded text-sm hover:bg-stone-700 transition-colors"
        >
          Procedi al checkout →
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verifica in locale**

Aggiungi prodotti dal catalogo e verifica che:
- Quantità si aggiorna e il totale ricalcola correttamente (con tier pricing)
- Rimuovere un item funziona
- Il carrello persiste tra reload (zustand persist)

- [ ] **Step 3: Commit**

```bash
git add b2b/src/app/carrello/
git commit -m "feat(b2b): pagina carrello con tier pricing"
```

---

## Task 7: Checkout — Form + Ordine + Bonifico

**Files:**
- Create: `b2b/src/app/checkout/page.tsx`
- Create: `b2b/src/app/api/checkout/route.ts`
- Create: `b2b/src/app/checkout/conferma/page.tsx`

- [ ] **Step 1: Crea helper per leggere session dal server**

Aggiungi a `b2b/src/lib/auth.ts`:

```typescript
import { cookies } from 'next/headers'

export async function getServerSession(): Promise<B2BSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return null
  return verifySessionToken(token)
}
```

- [ ] **Step 2: Crea `b2b/src/app/checkout/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useCart } from '@/lib/cart'
import { formatPrice } from '@/lib/pricing'
import { useRouter } from 'next/navigation'

interface FormData {
  // Fatturazione (pre-filled dalla sessione)
  businessName: string
  vatNumber: string
  sdiCode: string
  billingAddress1: string
  billingCity: string
  billingPostalCode: string
  billingCountry: string
  // Spedizione
  shippingName: string
  shippingAddress1: string
  shippingCity: string
  shippingPostalCode: string
  shippingCountry: string
  // Pagamento
  paymentMethod: 'bonifico' | 'stripe'
  notes: string
}

export default function CheckoutPage() {
  const { items, total, clear } = useCart()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState<{ businessName: string; vatNumber: string; contactName: string } | null>(null)
  const [form, setForm] = useState<FormData>({
    businessName: '', vatNumber: '', sdiCode: '', billingAddress1: '', billingCity: '',
    billingPostalCode: '', billingCountry: 'IT', shippingName: '', shippingAddress1: '',
    shippingCity: '', shippingPostalCode: '', shippingCountry: 'IT',
    paymentMethod: 'bonifico', notes: '',
  })

  useEffect(() => {
    fetch('/api/account/orders') // usa questo endpoint per ottenere dati sessione
      .then(r => r.json())
      .then(data => {
        if (data.session) {
          setSession(data.session)
          setForm(f => ({
            ...f,
            businessName: data.session.businessName,
            vatNumber: data.session.vatNumber,
            shippingName: data.session.businessName,
          }))
        }
      })
  }, [])

  if (items.length === 0) {
    router.replace('/carrello')
    return null
  }

  const cartTotal = total()
  const stripeTotal = cartTotal * 1.04
  const displayTotal = form.paymentMethod === 'stripe' ? stripeTotal : cartTotal

  function set(field: keyof FormData, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    if (form.paymentMethod === 'stripe') {
      // Stripe: crea PaymentIntent e reindirizza
      const res = await fetch('/api/stripe/create-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ form, items, total: stripeTotal }),
      })
      const { clientSecret, orderId } = await res.json()
      // Salva in sessionStorage per il completamento Stripe
      sessionStorage.setItem('stripe_order', JSON.stringify({ clientSecret, orderId, form }))
      router.push('/checkout/stripe-pay')
      return
    }

    // Bonifico: crea ordine direttamente
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form, items, total: cartTotal }),
    })

    if (res.ok) {
      const { orderNumber } = await res.json()
      clear()
      router.push(`/checkout/conferma?ordine=${orderNumber}&metodo=bonifico`)
    } else {
      alert('Errore durante la creazione dell\'ordine. Riprova.')
      setLoading(false)
    }
  }

  const inputClass = "border border-stone-300 rounded px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-stone-400"
  const labelClass = "block text-xs text-stone-500 mb-1"

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Checkout</h1>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* FATTURAZIONE */}
        <section>
          <h2 className="font-medium mb-4 pb-2 border-b border-stone-100">Dati fatturazione</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Ragione sociale *</label>
              <input required className={inputClass} value={form.businessName}
                onChange={e => set('businessName', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>P.IVA *</label>
              <input required className={inputClass} value={form.vatNumber}
                onChange={e => set('vatNumber', e.target.value)} placeholder="IT12345678901" />
            </div>
            <div>
              <label className={labelClass}>Codice SDI / PEC *</label>
              <input required className={inputClass} value={form.sdiCode}
                onChange={e => set('sdiCode', e.target.value)} placeholder="0000000 o pec@email.it" />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Indirizzo di fatturazione *</label>
              <input required className={inputClass} value={form.billingAddress1}
                onChange={e => set('billingAddress1', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Città *</label>
              <input required className={inputClass} value={form.billingCity}
                onChange={e => set('billingCity', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>CAP *</label>
              <input required className={inputClass} value={form.billingPostalCode}
                onChange={e => set('billingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* SPEDIZIONE */}
        <section>
          <h2 className="font-medium mb-4 pb-2 border-b border-stone-100">Indirizzo di spedizione</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelClass}>Nome / Ragione sociale destinatario *</label>
              <input required className={inputClass} value={form.shippingName}
                onChange={e => set('shippingName', e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Indirizzo *</label>
              <input required className={inputClass} value={form.shippingAddress1}
                onChange={e => set('shippingAddress1', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Città *</label>
              <input required className={inputClass} value={form.shippingCity}
                onChange={e => set('shippingCity', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>CAP *</label>
              <input required className={inputClass} value={form.shippingPostalCode}
                onChange={e => set('shippingPostalCode', e.target.value)} />
            </div>
          </div>
        </section>

        {/* PAGAMENTO */}
        <section>
          <h2 className="font-medium mb-4 pb-2 border-b border-stone-100">Metodo di pagamento</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3 border border-stone-200 rounded p-3 cursor-pointer hover:border-stone-400">
              <input type="radio" name="payment" value="bonifico"
                checked={form.paymentMethod === 'bonifico'}
                onChange={() => set('paymentMethod', 'bonifico')} />
              <div>
                <p className="text-sm font-medium">Bonifico bancario</p>
                <p className="text-xs text-stone-400">Riceverai le coordinate al momento della conferma</p>
              </div>
            </label>
            <label className="flex items-center gap-3 border border-stone-200 rounded p-3 cursor-pointer hover:border-stone-400">
              <input type="radio" name="payment" value="stripe"
                checked={form.paymentMethod === 'stripe'}
                onChange={() => set('paymentMethod', 'stripe')} />
              <div>
                <p className="text-sm font-medium">Carta di credito (Stripe)</p>
                <p className="text-xs text-stone-400">
                  Supplemento del 4% per pagamento con carta.
                  Totale con carta: {formatPrice(stripeTotal)}
                </p>
              </div>
            </label>
          </div>
        </section>

        {/* NOTE */}
        <div>
          <label className={labelClass}>Note (opzionale)</label>
          <textarea className={inputClass} rows={3} value={form.notes}
            onChange={e => set('notes', e.target.value)}
            placeholder="Note per l'ordine, istruzioni di consegna, ecc." />
        </div>

        {/* RIEPILOGO + SUBMIT */}
        <div className="bg-stone-50 rounded-lg p-4">
          <div className="flex justify-between text-sm mb-1">
            <span>Subtotale prodotti</span>
            <span>{formatPrice(cartTotal)}</span>
          </div>
          {form.paymentMethod === 'stripe' && (
            <div className="flex justify-between text-sm text-stone-500 mb-1">
              <span>Supplemento carta (4%)</span>
              <span>+{formatPrice(stripeTotal - cartTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm text-stone-400 mb-3">
            <span>Spedizione</span>
            <span>Da definire</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-stone-200 pt-3">
            <span>Totale</span>
            <span>{formatPrice(displayTotal)}</span>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-stone-900 text-white py-3 rounded text-sm hover:bg-stone-700 disabled:opacity-50"
        >
          {loading ? 'Elaborazione...' : form.paymentMethod === 'bonifico'
            ? 'Conferma ordine (pagamento tramite bonifico)'
            : 'Paga con carta →'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Crea `b2b/src/app/api/checkout/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'
import { createResellerOrder } from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'
import { calculateLineTotal } from '@/lib/pricing'

function generateOrderNumber(): string {
  const date = new Date()
  const yy = date.getFullYear().toString().slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `B2B-${yy}${mm}-${rand}`
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: 'Sessione scaduta' }, { status: 401 })

  const { form, items, total } = await req.json()

  const orderNumber = generateOrderNumber()

  const lineItemsForEmail = items.map((item: {
    productName: string; variantLabel: string; qty: number; unitPrice: number; priceTiers: []
  }) => ({
    name: `${item.productName} — ${item.variantLabel}`,
    qty: item.qty,
    total: calculateLineTotal(item.unitPrice, item.qty, item.priceTiers),
  }))

  await createResellerOrder({
    orderNumber,
    customerEmail: session.email,
    customerName: form.shippingName,
    vatNumber: form.vatNumber,
    businessName: form.businessName,
    sdiCode: form.sdiCode,
    billingAddress1: form.billingAddress1,
    billingCity: form.billingCity,
    billingPostalCode: form.billingPostalCode,
    billingCountry: form.billingCountry,
    shippingAddressName: form.shippingName,
    shippingAddress1: form.shippingAddress1,
    shippingCity: form.shippingCity,
    shippingPostalCode: form.shippingPostalCode,
    shippingCountry: form.shippingCountry,
    lineItems: items,
    total,
    shippingCost: 0,
    paymentMethod: 'bonifico',
    notes: form.notes,
  })

  await sendOrderConfirmation({
    email: session.email,
    contactName: session.contactName,
    orderNumber,
    total,
    paymentMethod: 'bonifico',
    lineItems: lineItemsForEmail,
  })

  return NextResponse.json({ orderNumber })
}
```

- [ ] **Step 4: Crea `b2b/src/app/checkout/conferma/page.tsx`**

```tsx
export default function ConfermaPage({
  searchParams,
}: {
  searchParams: { ordine?: string; metodo?: string }
}) {
  const isBonifico = searchParams.metodo === 'bonifico'

  return (
    <div className="max-w-lg mx-auto mt-16 text-center">
      <div className="text-4xl mb-4">✓</div>
      <h1 className="text-2xl font-semibold mb-2">Ordine confermato</h1>
      <p className="text-stone-500 text-sm mb-6">
        Numero ordine: <strong>{searchParams.ordine}</strong>
      </p>

      {isBonifico ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left text-sm">
          <p className="font-medium mb-2">Coordinate per il bonifico:</p>
          <p>Intestatario: <strong>The Foolish Butcher Srl</strong></p>
          <p>IBAN: <strong>IT00 X000 0000 0000 0000 0000 000</strong></p>
          <p className="text-stone-400 text-xs mt-2">
            Causale: {searchParams.ordine} — inserisci il numero d'ordine come causale.
          </p>
        </div>
      ) : (
        <p className="text-sm text-stone-500">Il pagamento è stato ricevuto.</p>
      )}

      <p className="text-sm text-stone-400 mt-4">
        Hai ricevuto la conferma d'ordine via email.
      </p>

      <a
        href="/catalogo"
        className="inline-block mt-8 border border-stone-300 rounded px-6 py-2 text-sm hover:border-stone-500"
      >
        Continua ad acquistare
      </a>
    </div>
  )
}
```

Nota: sostituisci l'IBAN con quello reale nelle coordinate bonifico.

- [ ] **Step 5: Verifica flusso bonifico in locale**

1. Aggiungi prodotti al carrello
2. Vai a `/checkout`
3. Compila i campi (usa dati di test)
4. Seleziona Bonifico
5. Conferma → verifica redirect a `/checkout/conferma`
6. Controlla DB: `SELECT * FROM orders WHERE source = 'reseller' ORDER BY created_at DESC LIMIT 1`
7. Controlla email di conferma ricevuta

- [ ] **Step 6: Commit**

```bash
git add b2b/src/app/checkout b2b/src/app/api/checkout
git commit -m "feat(b2b): checkout bonifico con creazione ordine e email conferma"
```

---

## Task 8: Checkout Stripe (+4%)

**Files:**
- Create: `b2b/src/app/api/stripe/create-intent/route.ts`
- Create: `b2b/src/app/api/stripe/webhook/route.ts`
- Create: `b2b/src/app/checkout/stripe-pay/page.tsx`

- [ ] **Step 1: Crea `b2b/src/app/api/stripe/create-intent/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'
import { createResellerOrder } from '@/lib/db'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

function generateOrderNumber(): string {
  const date = new Date()
  const yy = date.getFullYear().toString().slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `B2B-${yy}${mm}-${rand}`
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: 'Sessione scaduta' }, { status: 401 })

  const { form, items, total } = await req.json()

  // total è già total * 1.04 (calcolato lato client)
  const amountCents = Math.round(total * 100)
  const orderNumber = generateOrderNumber()

  // Crea ordine in DB con pipeline_state = 'received', pagamento pendente
  const orderId = await createResellerOrder({
    orderNumber,
    customerEmail: session.email,
    customerName: form.shippingName,
    vatNumber: form.vatNumber,
    businessName: form.businessName,
    sdiCode: form.sdiCode,
    billingAddress1: form.billingAddress1,
    billingCity: form.billingCity,
    billingPostalCode: form.billingPostalCode,
    billingCountry: form.billingCountry,
    shippingAddressName: form.shippingName,
    shippingAddress1: form.shippingAddress1,
    shippingCity: form.shippingCity,
    shippingPostalCode: form.shippingPostalCode,
    shippingCountry: form.shippingCountry,
    lineItems: items,
    total,
    shippingCost: 0,
    paymentMethod: 'stripe',
    notes: `${form.notes ?? ''} [Stripe +4%]`.trim(),
  })

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'eur',
    metadata: {
      orderId: String(orderId),
      orderNumber,
      resellerEmail: session.email,
    },
    automatic_payment_methods: { enabled: true },
  })

  return NextResponse.json({
    clientSecret: paymentIntent.client_secret,
    orderId,
    orderNumber,
  })
}
```

- [ ] **Step 2: Crea `b2b/src/app/api/stripe/webhook/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import sql from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const webhookSecret = process.env.STRIPE_B2B_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const orderId = pi.metadata.orderId
    const orderNumber = pi.metadata.orderNumber
    const email = pi.metadata.resellerEmail

    // Aggiorna stato ordine
    await sql`
      UPDATE orders SET
        revolut_status = 'completed',
        notes = COALESCE(notes, '') || ' [Stripe pagato]',
        updated_at = NOW()
      WHERE id = ${orderId}
    `

    // Recupera dati per email
    const rows = await sql<{ customer_name: string; total: number }[]>`
      SELECT customer_name, total FROM orders WHERE id = ${orderId}
    `
    if (rows[0]) {
      await sendOrderConfirmation({
        email,
        contactName: rows[0].customer_name,
        orderNumber,
        total: rows[0].total,
        paymentMethod: 'stripe',
        lineItems: [],  // semplificato: l'email di conferma dettagliata è già stata mandata al momento della creazione intent
      })
    }
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 3: Crea `b2b/src/app/checkout/stripe-pay/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCart } from '@/lib/cart'
import { useRouter } from 'next/navigation'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

function PayForm({ orderNumber, onSuccess }: { orderNumber: string; onSuccess: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError(null)

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/conferma?ordine=${orderNumber}&metodo=stripe`,
      },
    })

    if (stripeError) {
      setError(stripeError.message ?? 'Errore pagamento')
      setLoading(false)
    }
    // Se success, Stripe reindirizza a return_url
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full bg-stone-900 text-white py-3 rounded text-sm hover:bg-stone-700 disabled:opacity-50"
      >
        {loading ? 'Elaborazione...' : 'Paga ora'}
      </button>
    </form>
  )
}

export default function StripePayPage() {
  const [stripeData, setStripeData] = useState<{
    clientSecret: string; orderNumber: string
  } | null>(null)
  const { clear } = useCart()
  const router = useRouter()

  useEffect(() => {
    const data = sessionStorage.getItem('stripe_order')
    if (!data) { router.replace('/carrello'); return }
    const parsed = JSON.parse(data)
    setStripeData({ clientSecret: parsed.clientSecret, orderNumber: parsed.orderNumber })
  }, [router])

  if (!stripeData) return <p className="text-stone-400">Caricamento...</p>

  return (
    <div className="max-w-md mx-auto mt-10">
      <h1 className="text-xl font-semibold mb-6">Pagamento con carta</h1>
      <Elements
        stripe={stripePromise}
        options={{ clientSecret: stripeData.clientSecret, locale: 'it' }}
      >
        <PayForm
          orderNumber={stripeData.orderNumber}
          onSuccess={() => {
            sessionStorage.removeItem('stripe_order')
            clear()
          }}
        />
      </Elements>
    </div>
  )
}
```

- [ ] **Step 4: Registra webhook Stripe**

```bash
# In locale per test:
stripe listen --forward-to localhost:3002/api/stripe/webhook
# Copia il webhook secret in .env.local come STRIPE_B2B_WEBHOOK_SECRET

# In produzione: crea webhook su dashboard.stripe.com
# URL: https://rivenditori.thefoolishbutcher.com/api/stripe/webhook
# Events: payment_intent.succeeded
```

- [ ] **Step 5: Aggiungi variabili Stripe a `.env.local`**

```bash
echo "STRIPE_SECRET_KEY=sk_live_..." >> b2b/.env.local
echo "STRIPE_B2B_WEBHOOK_SECRET=whsec_..." >> b2b/.env.local
echo "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_..." >> b2b/.env.local
```

- [ ] **Step 6: Verifica flusso Stripe in locale**

1. Seleziona "Carta" nel checkout
2. Verifica che il totale mostrato sia +4%
3. Completa il form, clicca "Paga con carta"
4. Verifica redirect a stripe-pay
5. Usa carta test `4242 4242 4242 4242`
6. Verifica ordine creato in DB e redirect a conferma

- [ ] **Step 7: Commit**

```bash
git add b2b/src/app/api/stripe b2b/src/app/checkout/stripe-pay
git commit -m "feat(b2b): checkout Stripe con supplemento 4% su carta"
```

---

## Task 9: Account Rivenditore

**Files:**
- Create: `b2b/src/app/account/page.tsx`
- Create: `b2b/src/app/api/account/orders/route.ts`

- [ ] **Step 1: Crea `b2b/src/app/api/account/orders/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'
import { getResellerOrders } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: 'Sessione scaduta' }, { status: 401 })

  const orders = await getResellerOrders(session.email)

  return NextResponse.json({ session, orders })
}
```

- [ ] **Step 2: Crea `b2b/src/app/account/page.tsx`**

```tsx
'use client'
import { useEffect, useState } from 'react'
import { formatPrice } from '@/lib/pricing'

interface Order {
  id: number
  order_number: string
  total: number
  pipeline_state: string
  created_at: string
  tracking_number: string | null
}

const stateLabels: Record<string, string> = {
  received: 'Ricevuto',
  in_production: 'In produzione',
  shipped: 'Spedito',
  delivered: 'Consegnato',
}

export default function AccountPage() {
  const [data, setData] = useState<{
    session: { businessName: string; vatNumber: string; contactName: string }
    orders: Order[]
  } | null>(null)

  useEffect(() => {
    fetch('/api/account/orders').then(r => r.json()).then(setData)
  }, [])

  if (!data) return <p className="text-stone-400">Caricamento...</p>

  const { session, orders } = data

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Account</h1>

      {/* Profilo */}
      <div className="bg-stone-50 rounded-lg p-4 mb-8 text-sm">
        <p className="font-medium">{session.businessName}</p>
        <p className="text-stone-400">{session.contactName}</p>
        <p className="text-stone-400 text-xs mt-1">P.IVA: {session.vatNumber}</p>
      </div>

      {/* Storico ordini */}
      <h2 className="font-medium mb-4">Storico ordini</h2>
      {orders.length === 0 ? (
        <p className="text-stone-400 text-sm">Nessun ordine ancora.</p>
      ) : (
        <div className="divide-y divide-stone-100">
          {orders.map(order => (
            <div key={order.id} className="py-3 flex items-center gap-4 text-sm">
              <div className="flex-1">
                <p className="font-medium">{order.order_number}</p>
                <p className="text-stone-400 text-xs">
                  {new Date(order.created_at).toLocaleDateString('it-IT')}
                </p>
              </div>
              <div className="text-stone-500">{formatPrice(order.total)}</div>
              <div>
                <span className="bg-stone-100 text-stone-600 text-xs px-2 py-0.5 rounded">
                  {stateLabels[order.pipeline_state] ?? order.pipeline_state}
                </span>
              </div>
              {order.tracking_number && (
                <p className="text-xs text-stone-400">📦 {order.tracking_number}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verifica in locale**

Vai su `http://localhost:3002/account`. Verifica che si vedano i dati dell'azienda e gli ordini B2B (quelli con `source = 'reseller'` per quell'email).

- [ ] **Step 4: Commit**

```bash
git add b2b/src/app/account b2b/src/app/api/account
git commit -m "feat(b2b): account rivenditore con storico ordini"
```

---

## Task 10: Deploy Railway + Dominio

- [ ] **Step 1: Crea il nuovo servizio Railway**

```bash
cd /home/ab/dev/foolish-storefront
railway link --project 67155e0c-0706-460e-a201-1586b4e12096
railway add --service foolish-b2b --json
# Nota l'ID del nuovo servizio
```

- [ ] **Step 2: Configura il servizio (rootDirectory e Dockerfile)**

Tramite Railway dashboard o CLI:
```bash
railway service update \
  --service foolish-b2b \
  --root-directory /b2b \
  --build-command "npm run build" \
  --start-command "node server.js"
```

In alternativa, fallo dalla dashboard:
- Settings → Source → Root Directory: `b2b`
- Build → Builder: Dockerfile
- Build → Dockerfile Path: `b2b/Dockerfile`

- [ ] **Step 3: Imposta le variabili d'ambiente nel servizio Railway**

```bash
railway variables set \
  --service foolish-b2b \
  B2B_MAGIC_SECRET="$(openssl rand -base64 32)" \
  B2B_SESSION_SECRET="$(openssl rand -base64 32)" \
  DATABASE_URL="postgresql://postgres:yRvHQCeRpKZDXlURNKNCFKdWEmwTPeyi@postgres.railway.internal:5432/railway" \
  CMS_URL="https://cms-production-1dda.up.railway.app" \
  RESEND_API_KEY="re_REDACTED" \
  STRIPE_SECRET_KEY="sk_live_..." \
  STRIPE_B2B_WEBHOOK_SECRET="whsec_..." \
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_live_..." \
  NEXT_PUBLIC_URL="https://rivenditori.thefoolishbutcher.com" \
  NEXT_PUBLIC_CMS_URL="https://cms-production-1dda.up.railway.app"
```

Nota: usa il DB URL interno Railway (`.railway.internal`) per la comunicazione intra-servizio.

- [ ] **Step 4: Primo deploy**

```bash
git push origin feature/portale-rivenditori
# Railway rideploya il servizio foolish-b2b automaticamente
# Oppure triggera manualmente dalla dashboard
```

- [ ] **Step 5: Genera dominio Railway e aggiungi custom domain**

```bash
railway domain generate --service foolish-b2b
# oppure dalla dashboard: genera `foolish-b2b-production.up.railway.app`

# Aggiungi custom domain:
railway domain add rivenditori.thefoolishbutcher.com --service foolish-b2b
# Railway mostra il CNAME target (es. xyz123.up.railway.app)
```

- [ ] **Step 6: Configura DNS Cloudflare**

In Cloudflare DNS per `thefoolishbutcher.com`:
```
Tipo:   CNAME
Nome:   rivenditori
Target: [CNAME target mostrato da Railway nel passo precedente]
Proxy:  ON (arancione)
```

- [ ] **Step 7: Registra webhook Stripe per produzione**

Su `dashboard.stripe.com` → Developers → Webhooks → Add endpoint:
- URL: `https://rivenditori.thefoolishbutcher.com/api/stripe/webhook`
- Events: `payment_intent.succeeded`
- Copia il signing secret → aggiorna `STRIPE_B2B_WEBHOOK_SECRET` su Railway

- [ ] **Step 8: Test end-to-end su produzione**

1. Vai su `https://rivenditori.thefoolishbutcher.com`
2. Login con email ProMember reale
3. Verifica catalogo e prezzi
4. Fai un ordine test con bonifico
5. Verifica email di conferma
6. Controlla DB:
   ```sql
   SELECT * FROM orders WHERE source = 'reseller' ORDER BY created_at DESC LIMIT 5;
   ```

- [ ] **Step 9: Merge su main**

Solo quando tutti i test passano:
```bash
git checkout main
git merge feature/portale-rivenditori --no-ff -m "feat: portale rivenditori B2B"
git push origin main
```

---

## Checklist finale pre-launch

- [ ] Tutti i ProMember esistenti hanno email valida nel DB
- [ ] IBAN bonifico corretto nella pagina `/checkout/conferma`
- [ ] Stripe in modalità **live** (non test)
- [ ] Webhook Stripe registrato e secret aggiornato
- [ ] `robots.txt` con `noindex` (il portale non deve essere indicizzato)
- [ ] Verificato che un ProMember con `status = 'suspended'` non riesce ad accedere
- [ ] Almeno 2-3 prodotti con `resellerVisible = true` e fasce prezzo configurate nel CMS
- [ ] Prodotto dedicato rivenditori creato nel CMS

---

## Variabili d'ambiente complete (b2b/.env.local.example)

```bash
# Auth
B2B_MAGIC_SECRET=           # openssl rand -base64 32
B2B_SESSION_SECRET=         # openssl rand -base64 32

# Database (DB_FOOLISH)
DATABASE_URL=postgresql://postgres:PASSWORD@HOST:PORT/railway

# CMS
CMS_URL=https://cms-production-1dda.up.railway.app
NEXT_PUBLIC_CMS_URL=https://cms-production-1dda.up.railway.app

# Resend
RESEND_API_KEY=re_...

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_B2B_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...

# App URL
NEXT_PUBLIC_URL=https://rivenditori.thefoolishbutcher.com
```
