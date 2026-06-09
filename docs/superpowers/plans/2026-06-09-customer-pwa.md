# Customer PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare la PWA area cliente con magic link auth, 5 schermate (Home/Ordini/Collezione/File/Profilo), Web Push, quick reorder, wishlist, e fix immediato email tracking.

**Architecture:** Route group `(customer-app)/account/` nello storefront Next.js esistente. Auth via JWT magic link + cookie sessione 30 giorni. DB: nuove colonne su `marketing.subscribers` + tabella `account.wishlist`. Push notifiche via VAPID.

**Tech Stack:** Next.js 15 App Router, `postgres` (già in uso), `jose` (già installato), `web-push` (da installare), Resend, Payload CMS.

---

## File map

**CMS — modifiche:**
- `cms/src/collections/Orders.ts` — aggiunge hook `sendTrackingEmail`
- `cms/src/collections/CustomerFiles.ts` — nuova collection
- `cms/src/payload.config.ts` — registra CustomerFiles

**Storefront — nuovi file lib:**
- `storefront/src/lib/account-auth.ts` — JWT magic link + cookie sessione
- `storefront/src/lib/account-db.ts` — query DB per account (profilo, wishlist, file, ordini)
- `storefront/src/lib/push.ts` — invio Web Push VAPID

**Storefront — migration:**
- `storefront/scripts/migrate-account.sql` — nuove colonne subscribers + tabella wishlist

**Storefront — API routes:**
- `storefront/src/app/api/account/magic-link/route.ts`
- `storefront/src/app/api/account/logout/route.ts`
- `storefront/src/app/api/account/me/route.ts`
- `storefront/src/app/api/account/profile/route.ts`
- `storefront/src/app/api/account/wishlist/route.ts`
- `storefront/src/app/api/account/push-subscribe/route.ts`
- `storefront/src/app/api/account/reorder/[orderId]/route.ts`

**Storefront — PWA screens:**
- `storefront/public/manifest.json`
- `storefront/public/sw.js`
- `storefront/src/app/(customer-app)/account/layout.tsx`
- `storefront/src/app/(customer-app)/account/page.tsx`
- `storefront/src/app/(customer-app)/account/login/page.tsx`
- `storefront/src/app/(customer-app)/account/auth/page.tsx`
- `storefront/src/app/(customer-app)/account/ordini/page.tsx`
- `storefront/src/app/(customer-app)/account/ordini/[id]/page.tsx`
- `storefront/src/app/(customer-app)/account/collezione/page.tsx`
- `storefront/src/app/(customer-app)/account/file/page.tsx`
- `storefront/src/app/(customer-app)/account/profilo/page.tsx`

**Storefront — vecchie pagine da rimuovere:**
- `storefront/src/app/[locale]/account/page.tsx` → delete
- `storefront/src/app/[locale]/account/ordine/[id]/page.tsx` → delete

---

## Task 1: Hook email tracking (CMS)

**Files:**
- Modify: `cms/src/collections/Orders.ts`

- [ ] **1.1** Aggiungi le stringhe multilingue per l'email tracking subito dopo la chiusura di `ORDER_STRINGS` (intorno alla riga 137), prima di `const sendOrderConfirmation`:

```typescript
const TRACKING_STRINGS: Record<string, {
  subject: string; heading: string; body: string;
  trackLabel: string; carrierLabel: string; footer: string;
}> = {
  it: {
    subject: 'Il tuo ordine è in viaggio',
    heading: 'Spedito!',
    body: 'Il tuo ordine è stato spedito. Puoi tracciarlo usando le informazioni qui sotto.',
    trackLabel: 'Traccia il tuo ordine →',
    carrierLabel: 'Corriere',
    footer: 'The Foolish Butcher · Chieri (TO), Italia · Made in Italy',
  },
  en: {
    subject: 'Your order is on its way',
    heading: 'Shipped!',
    body: 'Your order has been shipped. You can track it using the information below.',
    trackLabel: 'Track your order →',
    carrierLabel: 'Carrier',
    footer: 'The Foolish Butcher · Chieri (TO), Italy · Made in Italy',
  },
  de: {
    subject: 'Ihre Bestellung ist unterwegs',
    heading: 'Versendet!',
    body: 'Ihre Bestellung wurde versendet. Sie können sie mit den folgenden Informationen verfolgen.',
    trackLabel: 'Bestellung verfolgen →',
    carrierLabel: 'Transportunternehmen',
    footer: 'The Foolish Butcher · Chieri (TO), Italien · Made in Italy',
  },
  fr: {
    subject: 'Votre commande est en route',
    heading: 'Expédié !',
    body: 'Votre commande a été expédiée. Vous pouvez la suivre avec les informations ci-dessous.',
    trackLabel: 'Suivre ma commande →',
    carrierLabel: 'Transporteur',
    footer: 'The Foolish Butcher · Chieri (TO), Italie · Made in Italy',
  },
  es: {
    subject: 'Tu pedido está en camino',
    heading: '¡Enviado!',
    body: 'Tu pedido ha sido enviado. Puedes rastrearlo con la información a continuación.',
    trackLabel: 'Rastrear mi pedido →',
    carrierLabel: 'Transportista',
    footer: 'The Foolish Butcher · Chieri (TO), Italia · Made in Italy',
  },
}
```

- [ ] **1.2** Aggiungi la funzione `sendTrackingEmail` dopo `notifyAlessandroByEmail` (circa riga 390), prima di `export const Orders`:

```typescript
const sendTrackingEmail: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  if (operation !== 'update') return
  if (!doc.trackingNumber) return
  if (previousDoc?.trackingNumber === doc.trackingNumber) return
  if (!doc.customerEmail) return

  const locale = (doc.customerLocale as string | null) ?? 'it'
  const t = TRACKING_STRINGS[locale] ?? TRACKING_STRINGS['en']!

  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM ?? 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
  if (!resendKey) return

  const storeFrontUrl = process.env.STOREFRONT_URL ?? 'https://thefoolishbutcher.com'
  const trackingUrl = `${storeFrontUrl}/ordine/${doc.pageToken}`

  const html = `
    <div style="font-family:monospace;max-width:480px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;">
      <div style="font-size:11px;letter-spacing:2px;color:#555;text-transform:uppercase;margin-bottom:24px;">The Foolish Butcher</div>
      <h1 style="font-size:22px;font-weight:300;color:#c9a96e;margin-bottom:16px;">${t.heading}</h1>
      <p style="color:#aaa;margin-bottom:24px;">${t.body}</p>
      <div style="background:#111;border:1px solid #333;border-radius:6px;padding:16px;margin-bottom:24px;">
        <div style="color:#555;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${t.carrierLabel}</div>
        <div style="color:#fff;font-size:14px;font-family:monospace;">${doc.trackingCarrier ?? ''} · ${doc.trackingNumber}</div>
      </div>
      <a href="${trackingUrl}" style="display:inline-block;background:#c9a96e;color:#000;padding:12px 24px;text-decoration:none;font-weight:bold;font-size:13px;border-radius:4px;">${t.trackLabel}</a>
      <p style="color:#444;font-size:11px;margin-top:32px;">${t.footer}</p>
    </div>
  `

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: doc.customerEmail,
        subject: t.subject,
        html,
      }),
    })
  } catch (err) {
    console.error('[Orders] sendTrackingEmail error:', err)
  }
}
```

- [ ] **1.3** Aggiungi `sendTrackingEmail` all'array `afterChange` in `hooks`:

```typescript
// Da:
afterChange: [sendOrderConfirmation, notifyNanobot, notifyAlessandroByEmail, syncCustomer],
// A:
afterChange: [sendOrderConfirmation, notifyNanobot, notifyAlessandroByEmail, syncCustomer, sendTrackingEmail],
```

- [ ] **1.4** Typecheck CMS:
```bash
cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
```
Expected: nessun errore.

- [ ] **1.5** Commit:
```bash
git add cms/src/collections/Orders.ts
git commit -m "feat(cms): send tracking email to customer via Resend when trackingNumber is set"
```

---

## Task 2: Migration DB

**Files:**
- Create: `storefront/scripts/migrate-account.sql`

- [ ] **2.1** Crea il file di migration:

```sql
-- Nuove colonne su marketing.subscribers
ALTER TABLE marketing.subscribers
  ADD COLUMN IF NOT EXISTS level TEXT
    CHECK (level IN ('tatuatore','pmu','studente','professionista')),
  ADD COLUMN IF NOT EXISTS styles TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS magic_link_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_subscription JSONB,
  ADD COLUMN IF NOT EXISTS notify_orders BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_new_batches BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_offers BOOLEAN DEFAULT false;

-- Aggiungi magic_link al tipo email_log
-- (il CHECK constraint su type non esiste nella migration corrente — solo nel codice TS)

-- Schema e tabella wishlist
CREATE SCHEMA IF NOT EXISTS account;

CREATE TABLE IF NOT EXISTS account.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_email TEXT NOT NULL,
  product_slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_price NUMERIC(10,2),
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  CONSTRAINT fk_wishlist_subscriber
    FOREIGN KEY (subscriber_email)
    REFERENCES marketing.subscribers(email)
    ON DELETE CASCADE,
  CONSTRAINT uq_wishlist_item
    UNIQUE (subscriber_email, product_slug)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_email ON account.wishlist(subscriber_email);
```

- [ ] **2.2** Esegui la migration sul DB Railway:
```bash
cd /home/ab/dev/foolish-storefront
railway run --service foolish-storefront psql $DATABASE_URL -f storefront/scripts/migrate-account.sql
```
Expected: `ALTER TABLE`, `CREATE SCHEMA`, `CREATE TABLE`, `CREATE INDEX` senza errori.

- [ ] **2.3** Aggiorna il tipo `EmailType` in `storefront/src/lib/marketing-db.ts`:
```typescript
// Da:
export type EmailType = 'welcome' | 'abandoned_cart' | 'review_request' | 'reengagement'
// A:
export type EmailType = 'welcome' | 'abandoned_cart' | 'review_request' | 'reengagement' | 'magic_link' | 'push_offer'
```

- [ ] **2.4** Commit:
```bash
git add storefront/scripts/migrate-account.sql storefront/src/lib/marketing-db.ts
git commit -m "feat(db): add account schema, wishlist table, subscriber profile columns"
```

---

## Task 3: CustomerFiles collection (CMS)

**Files:**
- Create: `cms/src/collections/CustomerFiles.ts`
- Modify: `cms/src/payload.config.ts`

- [ ] **3.1** Crea `cms/src/collections/CustomerFiles.ts`:

```typescript
import type { CollectionConfig } from 'payload'

export const CustomerFiles: CollectionConfig = {
  slug: 'customer-files',
  admin: {
    useAsTitle: 'title',
    description: 'File e risorse per i clienti. Lascia "Cliente" vuoto per renderlo visibile a tutti.',
    defaultColumns: ['title', 'customer', 'fileType', 'active', 'createdAt'],
  },
  access: {
    read: ({ req }) => !!req.user,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Titolo',
    },
    {
      name: 'file',
      type: 'upload',
      relationTo: 'media',
      required: true,
      label: 'File',
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      label: 'Cliente',
      admin: {
        description: 'Lascia vuoto per rendere il file visibile a tutti i clienti registrati.',
      },
    },
    {
      name: 'fileType',
      type: 'select',
      required: true,
      label: 'Tipo',
      options: [
        { label: 'Guida PDF', value: 'guide' },
        { label: 'Video', value: 'video' },
        { label: 'Risorsa', value: 'resource' },
      ],
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Attivo',
    },
  ],
}
```

- [ ] **3.2** Registra in `cms/src/payload.config.ts`:

```typescript
// Aggiungi import dopo gli import esistenti:
import { CustomerFiles } from './collections/CustomerFiles'

// Aggiungi a collections[]:
collections: [
  Products,
  Orders,
  Customers,
  Media,
  ProMembers,
  PromoCodes,
  CustomerFiles,   // ← aggiunto
  // ... resto invariato
```

- [ ] **3.3** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
```

- [ ] **3.4** Commit:
```bash
git add cms/src/collections/CustomerFiles.ts cms/src/payload.config.ts
git commit -m "feat(cms): add CustomerFiles collection for per-customer file uploads"
```

---

## Task 4: account-auth.ts

**Files:**
- Create: `storefront/src/lib/account-auth.ts`

- [ ] **4.1** Crea `storefront/src/lib/account-auth.ts`:

```typescript
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const getMagicSecret = () =>
  new TextEncoder().encode(process.env.MAGIC_LINK_SECRET!)

const getSessionSecret = () =>
  new TextEncoder().encode(process.env.SESSION_SECRET!)

export async function createMagicToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('15m')
    .setIssuedAt()
    .sign(getMagicSecret())
}

export async function verifyMagicToken(token: string): Promise<{ email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getMagicSecret())
    if (typeof payload.email !== 'string') return null
    return { email: payload.email }
  } catch {
    return null
  }
}

export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(getSessionSecret())
}

export async function getSession(): Promise<{ email: string } | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('foolish_session')?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, getSessionSecret())
    if (typeof payload.email !== 'string') return null
    return { email: payload.email }
  } catch {
    return null
  }
}

export const SESSION_COOKIE = {
  name: 'foolish_session',
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  },
}
```

- [ ] **4.2** Aggiungi le env vars necessarie nel file `.env.local` (storefront):
```
MAGIC_LINK_SECRET=<genera con: openssl rand -hex 32>
SESSION_SECRET=<genera con: openssl rand -hex 32>
```

- [ ] **4.3** Aggiungi le stesse su Railway per il servizio `foolish-storefront`:
```bash
railway variables set MAGIC_LINK_SECRET="..." SESSION_SECRET="..."
```

- [ ] **4.4** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

- [ ] **4.5** Commit:
```bash
git add storefront/src/lib/account-auth.ts
git commit -m "feat(auth): add magic link and session JWT utilities"
```

---

## Task 5: account-db.ts

**Files:**
- Create: `storefront/src/lib/account-db.ts`

- [ ] **5.1** Crea `storefront/src/lib/account-db.ts`:

```typescript
import sql from './db'

export interface AccountSubscriber {
  email: string
  name: string | null
  locale: string
  level: string | null
  styles: string[]
  notify_orders: boolean
  notify_new_batches: boolean
  notify_offers: boolean
  push_subscription: unknown | null
  total_spent: number
  purchase_count: number
}

export interface WishlistItem {
  id: string
  product_slug: string
  product_name: string
  product_price: number | null
  saved_at: Date
  notified_at: Date | null
}

export async function getAccountSubscriber(email: string): Promise<AccountSubscriber | null> {
  const rows = await sql<AccountSubscriber[]>`
    SELECT email, name, locale, level, styles,
           notify_orders, notify_new_batches, notify_offers,
           push_subscription, total_spent, purchase_count
    FROM marketing.subscribers
    WHERE email = ${email} AND status = 'active'
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function updateSubscriberProfile(
  email: string,
  data: {
    level?: string | null
    styles?: string[]
    locale?: string
    notify_orders?: boolean
    notify_new_batches?: boolean
    notify_offers?: boolean
  }
): Promise<void> {
  const updates: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.level !== undefined) { updates.push(`level = $${i++}`); values.push(data.level) }
  if (data.styles !== undefined) { updates.push(`styles = $${i++}`); values.push(data.styles) }
  if (data.locale !== undefined) { updates.push(`locale = $${i++}`); values.push(data.locale) }
  if (data.notify_orders !== undefined) { updates.push(`notify_orders = $${i++}`); values.push(data.notify_orders) }
  if (data.notify_new_batches !== undefined) { updates.push(`notify_new_batches = $${i++}`); values.push(data.notify_new_batches) }
  if (data.notify_offers !== undefined) { updates.push(`notify_offers = $${i++}`); values.push(data.notify_offers) }

  if (updates.length === 0) return

  values.push(email)
  await sql`
    UPDATE marketing.subscribers
    SET ${sql.unsafe(updates.join(', '))}, updated_at = NOW()
    WHERE email = ${email}
  `
}

export async function savePushSubscription(email: string, subscription: unknown): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET push_subscription = ${JSON.stringify(subscription)}::jsonb, updated_at = NOW()
    WHERE email = ${email}
  `
}

export async function getWishlist(email: string): Promise<WishlistItem[]> {
  return sql<WishlistItem[]>`
    SELECT id, product_slug, product_name, product_price, saved_at, notified_at
    FROM account.wishlist
    WHERE subscriber_email = ${email}
    ORDER BY saved_at DESC
  `
}

export async function addToWishlist(
  email: string,
  item: { product_slug: string; product_name: string; product_price?: number }
): Promise<void> {
  await sql`
    INSERT INTO account.wishlist (subscriber_email, product_slug, product_name, product_price)
    VALUES (${email}, ${item.product_slug}, ${item.product_name}, ${item.product_price ?? null})
    ON CONFLICT (subscriber_email, product_slug) DO NOTHING
  `
}

export async function removeFromWishlist(email: string, productSlug: string): Promise<void> {
  await sql`
    DELETE FROM account.wishlist
    WHERE subscriber_email = ${email} AND product_slug = ${productSlug}
  `
}
```

- [ ] **5.2** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

- [ ] **5.3** Commit:
```bash
git add storefront/src/lib/account-db.ts
git commit -m "feat(db): add account-db helpers for subscriber profile and wishlist"
```

---

## Task 6: API routes auth

**Files:**
- Create: `storefront/src/app/api/account/magic-link/route.ts`
- Create: `storefront/src/app/api/account/logout/route.ts`

- [ ] **6.1** Crea `storefront/src/app/api/account/magic-link/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createMagicToken } from '@/lib/account-auth'
import sql from '@/lib/db'

export async function POST(req: NextRequest) {
  let email: string
  try {
    const body = await req.json()
    email = (body.email ?? '').toString().toLowerCase().trim()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
  }

  // Rate limit: max 3 magic link emails per 10 min per email
  const recent = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM marketing.email_log
    WHERE email = ${email}
      AND type = 'magic_link'
      AND sent_at > NOW() - INTERVAL '10 minutes'
  `
  if (parseInt(recent[0]?.count ?? '0') >= 3) {
    // Silent: don't reveal rate limit to avoid enumeration
    return NextResponse.json({ ok: true })
  }

  // Check subscriber exists and is active
  const rows = await sql<{ email: string; name: string | null; locale: string }[]>`
    SELECT email, name, locale FROM marketing.subscribers
    WHERE email = ${email} AND status = 'active'
    LIMIT 1
  `
  // Always return ok to avoid email enumeration
  if (!rows.length) return NextResponse.json({ ok: true })

  const subscriber = rows[0]!
  const token = await createMagicToken(subscriber.email)
  const loginUrl = `${process.env.STOREFRONT_URL}/account/auth?token=${token}`
  const isIt = subscriber.locale === 'it'

  const html = `
    <div style="font-family:monospace;max-width:480px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;">
      <div style="font-size:11px;letter-spacing:2px;color:#555;text-transform:uppercase;margin-bottom:24px;">The Foolish Butcher</div>
      <p style="color:#aaa;margin-bottom:16px;">${isIt ? `Ciao${subscriber.name ? ` ${subscriber.name}` : ''},` : `Hi${subscriber.name ? ` ${subscriber.name}` : ''}`,}</p>
      <p style="color:#aaa;margin-bottom:24px;">${isIt ? 'Clicca per accedere alla tua area personale. Il link scade in 15 minuti.' : 'Click to access your personal area. The link expires in 15 minutes.'}</p>
      <a href="${loginUrl}" style="display:inline-block;background:#c9a96e;color:#000;padding:12px 24px;text-decoration:none;font-weight:bold;font-size:13px;border-radius:4px;">${isIt ? 'Accedi' : 'Sign in'}</a>
      <p style="color:#444;font-size:11px;margin-top:32px;">${isIt ? 'Se non hai richiesto questo link, ignora questa email.' : "If you didn't request this, ignore this email."}</p>
    </div>
  `

  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>',
        to: subscriber.email,
        subject: isIt ? 'Accedi alla tua area personale' : 'Sign in to your account',
        html,
      }),
    })
    const data = await res.json().catch(() => ({}))
    await sql`
      INSERT INTO marketing.email_log (email, type, resend_id)
      VALUES (${subscriber.email}, 'magic_link', ${(data as { id?: string }).id ?? null})
    `
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **6.2** Crea `storefront/src/app/api/account/logout/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/account-auth'
import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE.name)
  return NextResponse.json({ ok: true })
}
```

- [ ] **6.3** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

- [ ] **6.4** Commit:
```bash
git add storefront/src/app/api/account/magic-link/route.ts storefront/src/app/api/account/logout/route.ts
git commit -m "feat(api): add magic-link and logout account API routes"
```

---

## Task 7: API routes me, profile, wishlist, push, reorder

**Files:**
- Create: `storefront/src/app/api/account/me/route.ts`
- Create: `storefront/src/app/api/account/profile/route.ts`
- Create: `storefront/src/app/api/account/wishlist/route.ts`
- Create: `storefront/src/app/api/account/push-subscribe/route.ts`
- Create: `storefront/src/app/api/account/reorder/[orderId]/route.ts`

- [ ] **7.1** Crea `storefront/src/app/api/account/me/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber, getWishlist } from '@/lib/account-db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [subscriber, wishlist] = await Promise.all([
    getAccountSubscriber(session.email),
    getWishlist(session.email),
  ])

  if (!subscriber) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Fetch orders from CMS
  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const ordersRes = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=50&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, next: { revalidate: 0 } }
  )
  const ordersData = ordersRes.ok ? await ordersRes.json() : { docs: [] }

  return NextResponse.json({
    subscriber,
    orders: ordersData.docs ?? [],
    wishlist,
  })
}
```

- [ ] **7.2** Crea `storefront/src/app/api/account/profile/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { updateSubscriberProfile } from '@/lib/account-db'

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = ['level', 'styles', 'locale', 'notify_orders', 'notify_new_batches', 'notify_offers']
  const data = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  )

  await updateSubscriberProfile(session.email, data)
  return NextResponse.json({ ok: true })
}
```

- [ ] **7.3** Crea `storefront/src/app/api/account/wishlist/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { addToWishlist, removeFromWishlist } from '@/lib/account-db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product_slug, product_name, product_price } = await req.json()
  if (!product_slug || !product_name) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  await addToWishlist(session.email, { product_slug, product_name, product_price })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  await removeFromWishlist(session.email, slug)
  return NextResponse.json({ ok: true })
}
```

- [ ] **7.4** Crea `storefront/src/app/api/account/push-subscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { savePushSubscription } from '@/lib/account-db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subscription = await req.json()
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await savePushSubscription(session.email, subscription)
  return NextResponse.json({ ok: true })
}
```

- [ ] **7.5** Crea `storefront/src/app/api/account/reorder/[orderId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL

  // Fetch order from CMS
  const orderRes = await fetch(
    `${cmsUrl}/api/orders?where[orderNumber][equals]=${orderId}&where[customerEmail][equals]=${encodeURIComponent(session.email)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! } }
  )
  if (!orderRes.ok) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const orderData = await orderRes.json()
  const order = orderData.docs?.[0]
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const lineItems = order.lineItems as { name: string; variantLabel?: string; quantity: number; unitPrice: number }[]

  // Build Stripe line items using price_data (no stored price IDs needed)
  const stripeItems = lineItems.map((item) => ({
    price_data: {
      currency: 'eur',
      unit_amount: Math.round(item.unitPrice * 100),
      product_data: {
        name: item.variantLabel ? `${item.name} — ${item.variantLabel}` : item.name,
      },
    },
    quantity: item.quantity,
  }))

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: stripeItems,
    success_url: `${process.env.STOREFRONT_URL}/account/ordini?reorder=success`,
    cancel_url: `${process.env.STOREFRONT_URL}/account`,
    customer_email: session.email,
    metadata: {
      reorder_from: orderId,
      customer_email: session.email,
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
```

- [ ] **7.6** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

- [ ] **7.7** Commit:
```bash
git add storefront/src/app/api/account/
git commit -m "feat(api): add account API routes (me, profile, wishlist, push-subscribe, reorder)"
```

---

## Task 8: PWA manifest + service worker

**Files:**
- Create: `storefront/public/manifest.json`
- Create: `storefront/public/sw.js`

- [ ] **8.1** Crea `storefront/public/manifest.json`:

```json
{
  "name": "The Foolish Butcher",
  "short_name": "Foolish",
  "description": "La tua area personale",
  "start_url": "/account",
  "display": "standalone",
  "background_color": "#0d0d0d",
  "theme_color": "#0d0d0d",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

Nota: le icone `icon-192.png` e `icon-512.png` vanno aggiunte in `storefront/public/`. Usa il logo esistente ridimensionato a 192×192 e 512×512.

- [ ] **8.2** Crea `storefront/public/sw.js`:

```javascript
const CACHE_NAME = 'foolish-pwa-v1'
const OFFLINE_URL = '/account'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['/account', '/account/login'])
    )
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Only intercept same-origin navigation requests
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  )
})

// Web Push
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {}
  const title = data.title ?? 'The Foolish Butcher'
  const options = {
    body: data.body ?? '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url ?? '/account' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      const url = event.notification.data?.url ?? '/account'
      for (const client of clientList) {
        if (client.url.includes('/account') && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (clients.openWindow) return clients.openWindow(url)
    })
  )
})
```

- [ ] **8.3** Commit:
```bash
git add storefront/public/manifest.json storefront/public/sw.js
git commit -m "feat(pwa): add manifest.json and service worker with push support"
```

---

## Task 9: push.ts utility + VAPID setup

**Files:**
- Create: `storefront/src/lib/push.ts`

- [ ] **9.1** Installa `web-push`:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npm install web-push
npm install --save-dev @types/web-push
```

- [ ] **9.2** Genera chiavi VAPID:
```bash
cd /home/ab/dev/foolish-storefront/storefront && node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2))"
```
Salva `publicKey` e `privateKey` come env vars:
```
VAPID_PUBLIC_KEY=<publicKey>
VAPID_PRIVATE_KEY=<privateKey>
VAPID_SUBJECT=mailto:alessandro@thefoolishbutcher.com
```
Aggiungi anche su Railway.

- [ ] **9.3** Crea `storefront/src/lib/push.ts`:

```typescript
import webpush from 'web-push'
import sql from './db'

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

export interface PushPayload {
  title: string
  body: string
  url?: string
}

export async function sendPushToEmail(email: string, payload: PushPayload): Promise<boolean> {
  const rows = await sql<{ push_subscription: unknown }[]>`
    SELECT push_subscription FROM marketing.subscribers
    WHERE email = ${email} AND push_subscription IS NOT NULL
    LIMIT 1
  `
  if (!rows.length || !rows[0]?.push_subscription) return false

  try {
    await webpush.sendNotification(
      rows[0].push_subscription as webpush.PushSubscription,
      JSON.stringify(payload)
    )
    return true
  } catch (err: unknown) {
    // Subscription expired or invalid — clear it
    if (typeof err === 'object' && err !== null && 'statusCode' in err) {
      const statusCode = (err as { statusCode: number }).statusCode
      if (statusCode === 410 || statusCode === 404) {
        await sql`
          UPDATE marketing.subscribers SET push_subscription = NULL
          WHERE email = ${email}
        `
      }
    }
    return false
  }
}
```

- [ ] **9.4** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

- [ ] **9.5** Commit:
```bash
git add storefront/src/lib/push.ts storefront/package.json storefront/package-lock.json
git commit -m "feat(push): add Web Push VAPID utility"
```

---

## Task 10: PWA layout + login + auth pages

**Files:**
- Create: `storefront/src/app/(customer-app)/account/layout.tsx`
- Create: `storefront/src/app/(customer-app)/account/login/page.tsx`
- Create: `storefront/src/app/(customer-app)/account/auth/page.tsx`

- [ ] **10.1** Crea `storefront/src/app/(customer-app)/account/layout.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import Link from 'next/link'

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/account/login')

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0d0d', display: 'flex', flexDirection: 'column' }}>
      <script
        dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`,
        }}
      />
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: '60px' }}>
        {children}
      </main>
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#0a0a0a', borderTop: '1px solid #1a1a1a',
        zIndex: 50,
      }}>
        {[
          { href: '/account', label: 'Home', icon: '🏠' },
          { href: '/account/ordini', label: 'Ordini', icon: '📦' },
          { href: '/account/collezione', label: 'Collezione', icon: '🖼️' },
          { href: '/account/file', label: 'File', icon: '📁' },
          { href: '/account/profilo', label: 'Profilo', icon: '👤' },
        ].map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1, textAlign: 'center', padding: '10px 2px',
              color: '#555', fontSize: '9px', textTransform: 'uppercase',
              letterSpacing: '0.5px', textDecoration: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
            }}
          >
            <span style={{ fontSize: '18px' }}>{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
```

Nota: il link attivo (evidenziato) richiede un componente client che legge `usePathname()`. Aggiungi `BottomNav` come componente client separato se vuoi l'evidenziazione attiva — non è bloccante per il lancio.

- [ ] **10.2** Crea `storefront/src/app/(customer-app)/account/login/page.tsx`:

```typescript
'use client'
import { useState } from 'react'

export default function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/account/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '360px', width: '100%' }}>
        <div style={{ fontSize: '11px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '24px' }}>
          The Foolish Butcher
        </div>
        {sent ? (
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 300, color: '#fff', marginBottom: '12px' }}>Controlla la tua email</h1>
            <p style={{ color: '#666', fontSize: '13px' }}>
              Ti abbiamo inviato un link di accesso a <strong style={{ color: '#aaa' }}>{email}</strong>. Scade in 15 minuti.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={{ fontSize: '22px', fontWeight: 300, color: '#fff', marginBottom: '8px' }}>La tua area</h1>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
              Inserisci la tua email per ricevere il link di accesso.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@esempio.it"
              required
              style={{
                width: '100%', padding: '12px', background: '#111', border: '1px solid #333',
                borderRadius: '6px', color: '#fff', fontSize: '14px', boxSizing: 'border-box',
                marginBottom: '12px', outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px', background: '#c9a96e', color: '#000',
                border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Invio...' : 'Invia link →'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **10.3** Crea `storefront/src/app/(customer-app)/account/auth/page.tsx`:

```typescript
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/account-auth'

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  if (!token) redirect('/account/login?error=missing')

  const payload = await verifyMagicToken(token)
  if (!payload) redirect('/account/login?error=expired')

  const sessionToken = await createSessionToken(payload.email)
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)

  redirect('/account')
}
```

- [ ] **10.4** Rimuovi le vecchie pagine account:
```bash
rm /home/ab/dev/foolish-storefront/storefront/src/app/\[locale\]/account/page.tsx
rm -rf /home/ab/dev/foolish-storefront/storefront/src/app/\[locale\]/account/ordine
```

- [ ] **10.5** Typecheck:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
```

- [ ] **10.6** Commit:
```bash
git add storefront/src/app/
git commit -m "feat(pwa): add PWA layout, login page, auth callback — remove old account pages"
```

---

## Task 11: Home page

**Files:**
- Create: `storefront/src/app/(customer-app)/account/page.tsx`

- [ ] **11.1** Crea `storefront/src/app/(customer-app)/account/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber, getWishlist } from '@/lib/account-db'
import Link from 'next/link'

export default async function AccountHome() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const [subscriber, wishlist] = await Promise.all([
    getAccountSubscriber(session.email),
    getWishlist(session.email),
  ])
  if (!subscriber) redirect('/account/login')

  // Fetch orders
  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const ordersRes = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=10&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const ordersData = ordersRes.ok ? await ordersRes.json() : { docs: [] }
  const orders = ordersData.docs ?? []

  const activeOrder = orders.find((o: Record<string, unknown>) =>
    !['closed', 'delivered', 'followup_done'].includes(o.pipelineState as string)
  )
  const lastDelivered = orders.find((o: Record<string, unknown>) => o.pipelineState === 'delivered')

  const PIPELINE_PROGRESS: Record<string, number> = {
    received: 10, eta_pending: 15, eta_confirmed: 25, in_production: 45,
    matching_pending: 60, matched: 70, preview_sent: 80, shipped: 90,
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      {/* Header */}
      <div style={{ marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
          The Foolish Butcher
        </div>
        <div style={{ fontSize: '20px', fontWeight: 300 }}>
          Ciao{subscriber.name ? `, ${subscriber.name.split(' ')[0]}` : ''}
        </div>
        <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>
          {subscriber.level ?? 'Cliente'} · {subscriber.purchase_count} ordini
        </div>
      </div>

      {/* Ordine attivo */}
      {activeOrder && (
        <Link href={`/account/ordini/${activeOrder.orderNumber}`} style={{ textDecoration: 'none' }}>
          <div style={{ background: '#111', border: '1px solid #c9a96e44', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', color: '#c9a96e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>
              Ordine in corso
            </div>
            <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
              #{activeOrder.orderNumber}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <div style={{ width: '6px', height: '6px', background: '#c9a96e', borderRadius: '50%' }} />
              <div style={{ fontSize: '11px', color: '#c9a96e' }}>
                {activeOrder.pipelineState}
                {activeOrder.productionEtaDays ? ` · ETA ${activeOrder.productionEtaDays} giorni` : ''}
              </div>
            </div>
            <div style={{ background: '#1a1a1a', borderRadius: '2px', height: '3px', marginBottom: '4px' }}>
              <div style={{ background: '#c9a96e', height: '3px', borderRadius: '2px', width: `${PIPELINE_PROGRESS[activeOrder.pipelineState as string] ?? 50}%` }} />
            </div>
          </div>
        </Link>
      )}

      {/* Ultimo ordine + Riordina */}
      {lastDelivered && (
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
            Ultimo ricevuto
          </div>
          <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
            #{lastDelivered.orderNumber}
          </div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '10px' }}>
            {Array.isArray(lastDelivered.lineItems) ? (lastDelivered.lineItems as { name: string }[]).map(i => i.name).join(', ') : ''}
          </div>
          <ReorderButton orderId={lastDelivered.orderNumber as string} />
        </div>
      )}

      {/* Wishlist preview */}
      {wishlist.length > 0 && (
        <div style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '10px' }}>
            Salvati ({wishlist.length})
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {wishlist.slice(0, 3).map((item) => (
              <div key={item.id} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', color: '#aaa' }}>
                {item.product_name}
              </div>
            ))}
            {wishlist.length > 3 && (
              <Link href="/account/file" style={{ background: '#1a1a1a', border: '1px solid #c9a96e44', borderRadius: '4px', padding: '5px 10px', fontSize: '11px', color: '#c9a96e', textDecoration: 'none' }}>
                Vedi tutti →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ReorderButton({ orderId }: { orderId: string }) {
  'use client'
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useState } = require('react')
  const [loading, setLoading] = useState(false)

  async function handleReorder() {
    setLoading(true)
    const res = await fetch(`/api/account/reorder/${orderId}`, { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setLoading(false)
  }

  return (
    <button
      onClick={handleReorder}
      disabled={loading}
      style={{ background: '#c9a96e', color: '#000', border: 'none', padding: '7px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
    >
      {loading ? '...' : 'Riordina'}
    </button>
  )
}
```

Nota: `ReorderButton` usa `'use client'` inline — in alternativa, spostalo in un file `_components/ReorderButton.tsx` se si preferisce separare. Il `require` è un workaround per usare un client component inline in un server component; per pulizia meglio separare.

- [ ] **11.2** Spostare `ReorderButton` in file separato:

Crea `storefront/src/app/(customer-app)/account/_components/ReorderButton.tsx`:
```typescript
'use client'
import { useState } from 'react'

export function ReorderButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false)

  async function handleReorder() {
    setLoading(true)
    const res = await fetch(`/api/account/reorder/${orderId}`, { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setLoading(false)
  }

  return (
    <button
      onClick={handleReorder}
      disabled={loading}
      style={{ background: '#c9a96e', color: '#000', border: 'none', padding: '7px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
    >
      {loading ? '...' : 'Riordina'}
    </button>
  )
}
```

Aggiorna `page.tsx` per importarlo: rimuovi la funzione `ReorderButton` inline e aggiungi:
```typescript
import { ReorderButton } from './_components/ReorderButton'
```

- [ ] **11.3** Typecheck + commit:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
git add storefront/src/app/\(customer-app\)/
git commit -m "feat(pwa): add Home screen with active order, last order reorder, wishlist preview"
```

---

## Task 12: Ordini pages

**Files:**
- Create: `storefront/src/app/(customer-app)/account/ordini/page.tsx`
- Create: `storefront/src/app/(customer-app)/account/ordini/[id]/page.tsx`

- [ ] **12.1** Crea `storefront/src/app/(customer-app)/account/ordini/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import Link from 'next/link'

const STATE_LABELS: Record<string, string> = {
  received: 'Ricevuto', eta_pending: 'In attesa ETA', eta_confirmed: 'Confermato',
  in_production: 'In produzione', matching_pending: 'Abbinamento', matched: 'Abbinato',
  preview_sent: 'Preview inviata', shipped: 'Spedito', delivered: 'Consegnato',
  followup_done: 'Completato', closed: 'Chiuso',
}

const ACTIVE_STATES = ['received','eta_pending','eta_confirmed','in_production','matching_pending','matched','preview_sent','shipped']

export default async function OrdiniPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=50&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const orders = data.docs ?? []

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>I tuoi ordini</div>
        <div style={{ fontSize: '18px', fontWeight: 300 }}>{orders.length} ordini totali</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {orders.map((order: Record<string, unknown>) => {
          const isActive = ACTIVE_STATES.includes(order.pipelineState as string)
          return (
            <div key={order.id as string} style={{ background: '#111', border: `1px solid ${isActive ? '#c9a96e44' : '#1e1e1e'}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                <div style={{ fontSize: '13px' }}>#{order.orderNumber as string}</div>
                <div style={{ background: isActive ? '#c9a96e22' : '#5a7a5a22', color: isActive ? '#c9a96e' : '#5a7a5a', fontSize: '10px', padding: '2px 7px', borderRadius: '10px' }}>
                  {STATE_LABELS[order.pipelineState as string] ?? order.pipelineState as string}
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                €{(order.total as number)?.toFixed(2)}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {!isActive && <ReorderButtonSmall orderId={order.orderNumber as string} />}
                <Link href={`/account/ordini/${order.orderNumber}`} style={{ background: '#1a1a1a', color: '#aaa', fontSize: '10px', padding: '4px 8px', borderRadius: '3px', border: '1px solid #333', textDecoration: 'none' }}>
                  Dettaglio →
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Inline client component for reorder button
import { ReorderButton as ReorderButtonSmall } from '../_components/ReorderButton'
```

- [ ] **12.2** Crea `storefront/src/app/(customer-app)/account/ordini/[id]/page.tsx`:

```typescript
import { redirect, notFound } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import Link from 'next/link'
import { ReorderButton } from '../../_components/ReorderButton'

const PIPELINE_STEPS = ['received','in_production','shipped','delivered']
const STATE_LABELS: Record<string, string> = {
  received: 'Ricevuto', in_production: 'In produzione', shipped: 'Spedito', delivered: 'Consegnato',
}

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession()
  if (!session) redirect('/account/login')

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/orders?where[orderNumber][equals]=${id}&where[customerEmail][equals]=${encodeURIComponent(session.email)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const order = data.docs?.[0]
  if (!order) notFound()

  const currentStepIndex = PIPELINE_STEPS.findIndex((s) => s === order.pipelineState)
  const deliveredIndex = PIPELINE_STEPS.indexOf('delivered')
  const isDelivered = order.pipelineState === 'delivered' || order.pipelineState === 'followup_done' || order.pipelineState === 'closed'

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', paddingTop: '8px' }}>
        <Link href="/account/ordini" style={{ color: '#555', fontSize: '20px', textDecoration: 'none' }}>←</Link>
        <div>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase' }}>Ordine #{order.orderNumber}</div>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ background: '#111', borderRadius: '8px', padding: '14px', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < PIPELINE_STEPS.length - 1 ? 1 : undefined }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', margin: '0 auto 4px', background: isDelivered || i <= currentStepIndex ? '#5a7a5a' : '#333', boxShadow: i === currentStepIndex && !isDelivered ? '0 0 6px #c9a96e' : 'none' }} />
                <div style={{ fontSize: '8px', color: isDelivered || i <= currentStepIndex ? '#5a7a5a' : '#444', whiteSpace: 'nowrap' }}>{STATE_LABELS[step]}</div>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div style={{ flex: 1, height: '1px', background: isDelivered || i < currentStepIndex ? '#5a7a5a' : '#333', margin: '0 4px 12px' }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Foto fogli */}
      {Array.isArray(order.sheetPhotos) && order.sheetPhotos.length > 0 && (
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>I tuoi fogli</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {(order.sheetPhotos as { url: string; caption?: string }[]).map((photo, i) => (
              <div key={i}>
                <img src={photo.url} alt={photo.caption ?? ''} style={{ width: '100%', borderRadius: '6px', aspectRatio: '1', objectFit: 'cover', border: '1px solid #222' }} />
                {photo.caption && <div style={{ fontSize: '10px', color: '#555', marginTop: '3px' }}>{photo.caption}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tracking */}
      {order.trackingNumber && (
        <div style={{ background: '#111', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '6px' }}>Tracking</div>
          <div style={{ fontSize: '12px', color: '#aaa', fontFamily: 'monospace' }}>
            {order.trackingCarrier} · {order.trackingNumber}
          </div>
        </div>
      )}

      {/* CTA */}
      {isDelivered && <ReorderButton orderId={order.orderNumber} />}
    </div>
  )
}
```

- [ ] **12.3** Typecheck + commit:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
git add storefront/src/app/\(customer-app\)/account/ordini/
git commit -m "feat(pwa): add Ordini list and detail pages"
```

---

## Task 13: Collezione page

**Files:**
- Create: `storefront/src/app/(customer-app)/account/collezione/page.tsx`

- [ ] **13.1** Crea `storefront/src/app/(customer-app)/account/collezione/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'

interface SheetPhoto { url: string; caption?: string }
interface OrderDoc { orderNumber: string; sheetPhotos?: SheetPhoto[]; lineItems?: { variantLabel?: string }[]; pipelineState: string }

function extractFormat(lineItems?: { variantLabel?: string }[]): string {
  const label = lineItems?.[0]?.variantLabel ?? ''
  if (label.includes('A4')) return 'A4'
  if (label.includes('A5')) return 'A5'
  if (label.includes('XXL')) return 'XXL'
  return 'Altro'
}

export default async function Collezionepage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=50&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const orders: OrderDoc[] = data.docs ?? []

  const ACTIVE_STATES = ['received','eta_pending','eta_confirmed','in_production','matching_pending','matched','preview_sent','shipped']

  // Aggregate sheets
  const allSheets = orders.flatMap((order) => {
    if (!order.sheetPhotos?.length) return []
    return order.sheetPhotos.map((photo) => ({
      ...photo,
      format: extractFormat(order.lineItems),
      orderNumber: order.orderNumber,
      isActive: ACTIVE_STATES.includes(order.pipelineState),
    }))
  })

  const totalInArrivo = orders
    .filter((o) => ACTIVE_STATES.includes(o.pipelineState))
    .reduce((sum, o) => sum + (o.lineItems?.length ?? 0), 0)

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>La tua collezione</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ fontSize: '18px', fontWeight: 300 }}>{allSheets.length} fogli ricevuti</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{orders.length} ordini</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
        {allSheets.map((sheet, i) => (
          <div key={i} style={{ background: '#1a1a1a', borderRadius: '6px', overflow: 'hidden', border: '1px solid #222' }}>
            <img
              src={sheet.url}
              alt={sheet.caption ?? ''}
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }}
            />
            <div style={{ padding: '5px 6px' }}>
              <div style={{ fontSize: '9px', color: '#c9a96e' }}>{sheet.format}</div>
              {sheet.caption && <div style={{ fontSize: '9px', color: '#555', marginTop: '1px' }}>{sheet.caption}</div>}
            </div>
          </div>
        ))}

        {/* Fogli in arrivo */}
        {totalInArrivo > 0 && (
          <div style={{ background: '#1a1a1a', borderRadius: '6px', border: '1px dashed #333' }}>
            <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', color: '#333' }}>
              +{totalInArrivo}
            </div>
            <div style={{ padding: '5px 6px' }}>
              <div style={{ fontSize: '9px', color: '#444' }}>In arrivo</div>
            </div>
          </div>
        )}
      </div>

      {allSheets.length === 0 && (
        <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>
          I tuoi fogli appariranno qui dopo la spedizione.
        </div>
      )}
    </div>
  )
}
```

- [ ] **13.2** Typecheck + commit:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
git add storefront/src/app/\(customer-app\)/account/collezione/
git commit -m "feat(pwa): add Collezione page with sheet photos gallery"
```

---

## Task 14: File page

**Files:**
- Create: `storefront/src/app/(customer-app)/account/file/page.tsx`
- Create: `storefront/src/app/(customer-app)/account/file/_components/WishlistItem.tsx`

- [ ] **14.1** Crea `storefront/src/app/(customer-app)/account/file/_components/WishlistItem.tsx`:

```typescript
'use client'
import { useState } from 'react'

export function WishlistItemActions({ slug, name }: { slug: string; name: string }) {
  const [removed, setRemoved] = useState(false)

  async function handleRemove() {
    await fetch(`/api/account/wishlist?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
    setRemoved(true)
  }

  if (removed) return null

  return (
    <button
      onClick={handleRemove}
      style={{ background: 'transparent', border: '1px solid #333', color: '#555', fontSize: '10px', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer' }}
    >
      Rimuovi
    </button>
  )
}
```

- [ ] **14.2** Crea `storefront/src/app/(customer-app)/account/file/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getWishlist } from '@/lib/account-db'
import { WishlistItemActions } from './_components/WishlistItem'

interface CustomerFile {
  id: string
  title: string
  fileType: string
  active: boolean
  file?: { url?: string; filename?: string; filesize?: number }
  customer?: { email?: string } | null
}

export default async function FilePage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL

  // Fetch files for this customer (customer = email OR customer = null)
  const filesRes = await fetch(
    `${cmsUrl}/api/customer-files?where[active][equals]=true&limit=50&depth=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const filesData = filesRes.ok ? await filesRes.json() : { docs: [] }
  const allFiles: CustomerFile[] = filesData.docs ?? []

  // Filter: show files where customer is null (global) or customer.email === session.email
  const myFiles = allFiles.filter((f) => !f.customer || f.customer?.email === session.email)

  const wishlist = await getWishlist(session.email)

  const FILE_ICON: Record<string, string> = { guide: '📄', video: '🎬', resource: '📎' }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>File & Wishlist</div>
        <div style={{ fontSize: '18px', fontWeight: 300 }}>Le tue risorse</div>
      </div>

      {/* File section */}
      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        File ({myFiles.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
        {myFiles.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>Nessun file disponibile al momento.</div>
        )}
        {myFiles.map((file) => {
          const fileUrl = file.file?.url
          const mediaBase = process.env.NEXT_PUBLIC_CMS_URL ?? ''
          const fullUrl = fileUrl?.startsWith('http') ? fileUrl : `${mediaBase}${fileUrl}`
          return (
            <a
              key={file.id}
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
            >
              <div style={{ width: '36px', height: '36px', background: '#1a1a1a', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                {FILE_ICON[file.fileType] ?? '📎'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', color: '#fff', marginBottom: '2px' }}>{file.title}</div>
                {file.file?.filesize && (
                  <div style={{ fontSize: '10px', color: '#555' }}>
                    {(file.file.filesize / 1024 / 1024).toFixed(1)} MB
                  </div>
                )}
              </div>
              <div style={{ color: '#c9a96e', fontSize: '14px' }}>↓</div>
            </a>
          )
        })}
      </div>

      {/* Wishlist section */}
      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        Salvati ({wishlist.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {wishlist.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>Nessun prodotto salvato. Usa il bottone "Salva" sui prodotti.</div>
        )}
        {wishlist.map((item) => (
          <div key={item.id} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', color: '#fff', marginBottom: '2px' }}>{item.product_name}</div>
              {item.product_price && (
                <div style={{ fontSize: '10px', color: '#555' }}>€{item.product_price.toFixed(2)}</div>
              )}
            </div>
            <a
              href={`/prodotti/${item.product_slug}`}
              style={{ background: '#c9a96e', color: '#000', fontSize: '10px', padding: '5px 10px', borderRadius: '4px', fontWeight: 600, textDecoration: 'none' }}
            >
              Acquista
            </a>
            <WishlistItemActions slug={item.product_slug} name={item.product_name} />
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **14.3** Typecheck + commit:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
git add storefront/src/app/\(customer-app\)/account/file/
git commit -m "feat(pwa): add File page with customer files download and wishlist"
```

---

## Task 15: Profilo page

**Files:**
- Create: `storefront/src/app/(customer-app)/account/profilo/page.tsx`
- Create: `storefront/src/app/(customer-app)/account/profilo/_components/ProfileForm.tsx`

- [ ] **15.1** Crea `storefront/src/app/(customer-app)/account/profilo/_components/ProfileForm.tsx`:

```typescript
'use client'
import { useState } from 'react'

interface ProfileFormProps {
  level: string | null
  styles: string[]
  locale: string
  notifyOrders: boolean
  notifyNewBatches: boolean
  notifyOffers: boolean
  pushPublicKey: string
}

const LEVELS = ['tatuatore','pmu','studente','professionista']
const STYLES = ['linework_fine','blackwork','realism','old_school','watercolor','tribal','geometric']
const STYLE_LABELS: Record<string, string> = {
  linework_fine: 'Linework fine', blackwork: 'Blackwork', realism: 'Realism',
  old_school: 'Old school', watercolor: 'Watercolor', tribal: 'Tribal', geometric: 'Geometric',
}
const LOCALES = [
  { code: 'it', label: '🇮🇹 Italiano' },
  { code: 'en', label: '🇬🇧 English' },
  { code: 'de', label: '🇩🇪 Deutsch' },
  { code: 'fr', label: '🇫🇷 Français' },
  { code: 'es', label: '🇪🇸 Español' },
]

export function ProfileForm({ level, styles, locale, notifyOrders, notifyNewBatches, notifyOffers, pushPublicKey }: ProfileFormProps) {
  const [form, setForm] = useState({ level, styles, locale, notifyOrders, notifyNewBatches, notifyOffers })
  const [saved, setSaved] = useState(false)
  const [pushStatus, setPushStatus] = useState<'unknown'|'active'|'denied'>('unknown')

  async function save(updates: Partial<typeof form>) {
    const next = { ...form, ...updates }
    setForm(next)
    await fetch('/api/account/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: next.level,
        styles: next.styles,
        locale: next.locale,
        notify_orders: next.notifyOrders,
        notify_new_batches: next.notifyNewBatches,
        notify_offers: next.notifyOffers,
      }),
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function enablePush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') { setPushStatus('denied'); return }

    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: pushPublicKey,
    })
    await fetch('/api/account/push-subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    })
    setPushStatus('active')
  }

  async function logout() {
    await fetch('/api/account/logout', { method: 'POST' })
    window.location.href = '/account/login'
  }

  function toggleStyle(style: string) {
    const next = form.styles.includes(style)
      ? form.styles.filter((s) => s !== style)
      : [...form.styles, style]
    save({ styles: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {saved && <div style={{ background: '#5a7a5a22', color: '#5a7a5a', fontSize: '11px', padding: '6px 10px', borderRadius: '4px' }}>Salvato ✓</div>}

      {/* Livello */}
      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Chi sei</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => save({ level: l })}
              style={{ background: form.level === l ? '#c9a96e' : '#1a1a1a', color: form.level === l ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.level === l ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.level === l ? 600 : 400 }}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Stile */}
      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Stile preferito</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {STYLES.map((s) => (
            <button key={s} onClick={() => toggleStyle(s)}
              style={{ background: form.styles.includes(s) ? '#c9a96e' : '#1a1a1a', color: form.styles.includes(s) ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.styles.includes(s) ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.styles.includes(s) ? 600 : 400 }}>
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Lingua */}
      <div>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Lingua comunicazioni</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {LOCALES.map(({ code, label }) => (
            <button key={code} onClick={() => save({ locale: code })}
              style={{ background: form.locale === code ? '#c9a96e' : '#1a1a1a', color: form.locale === code ? '#000' : '#555', fontSize: '11px', padding: '5px 12px', borderRadius: '16px', border: '1px solid', borderColor: form.locale === code ? '#c9a96e' : '#333', cursor: 'pointer', fontWeight: form.locale === code ? 600 : 400 }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Notifiche */}
      <div style={{ background: '#111', borderRadius: '8px', padding: '14px' }}>
        <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Notifiche</div>
        {([
          { key: 'notifyOrders', label: 'Aggiornamenti ordine', sub: 'Produzione, spedizione, consegna' },
          { key: 'notifyNewBatches', label: 'Nuovi lotti', sub: 'Quando arriva flock che ti piace' },
          { key: 'notifyOffers', label: 'Offerte personalizzate', sub: 'Max 1 a settimana' },
        ] as const).map(({ key, label, sub }) => (
          <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#fff' }}>{label}</div>
              <div style={{ fontSize: '10px', color: '#555' }}>{sub}</div>
            </div>
            <div
              onClick={() => save({ [key]: !form[key] })}
              style={{ width: '36px', height: '20px', background: form[key] ? '#c9a96e' : '#333', borderRadius: '10px', position: 'relative', cursor: 'pointer' }}
            >
              <div style={{ width: '16px', height: '16px', background: form[key] ? '#000' : '#666', borderRadius: '50%', position: 'absolute', top: '2px', [form[key] ? 'right' : 'left']: '2px', transition: 'all 0.15s' }} />
            </div>
          </div>
        ))}

        <div style={{ borderTop: '1px solid #1a1a1a', paddingTop: '10px', marginTop: '4px' }}>
          {pushStatus === 'active' ? (
            <div style={{ fontSize: '11px', color: '#5a7a5a' }}>✓ Push notifiche attive</div>
          ) : pushStatus === 'denied' ? (
            <div style={{ fontSize: '11px', color: '#888' }}>Push bloccate dal browser. Abilita dalle impostazioni.</div>
          ) : (
            <button onClick={enablePush}
              style={{ background: '#1a1a1a', color: '#c9a96e', border: '1px solid #c9a96e44', fontSize: '11px', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>
              Attiva notifiche push →
            </button>
          )}
        </div>
      </div>

      {/* Logout */}
      <div style={{ textAlign: 'center', paddingTop: '8px' }}>
        <button onClick={logout} style={{ background: 'transparent', border: 'none', color: '#444', fontSize: '11px', cursor: 'pointer' }}>
          Esci dall&apos;account
        </button>
      </div>
    </div>
  )
}
```

- [ ] **15.2** Crea `storefront/src/app/(customer-app)/account/profilo/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber } from '@/lib/account-db'
import { ProfileForm } from './_components/ProfileForm'

export default async function ProfiloPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const subscriber = await getAccountSubscriber(session.email)
  if (!subscriber) redirect('/account/login')

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ width: '44px', height: '44px', background: '#1a1a1a', border: '1px solid #c9a96e44', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#c9a96e' }}>
          {subscriber.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 300 }}>{subscriber.name ?? 'Cliente'}</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{subscriber.email}</div>
        </div>
      </div>

      <ProfileForm
        level={subscriber.level}
        styles={subscriber.styles ?? []}
        locale={subscriber.locale}
        notifyOrders={subscriber.notify_orders}
        notifyNewBatches={subscriber.notify_new_batches}
        notifyOffers={subscriber.notify_offers}
        pushPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''}
      />
    </div>
  )
}
```

- [ ] **15.3** Aggiungi `NEXT_PUBLIC_VAPID_PUBLIC_KEY` alle env vars (storefront e Railway):
```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<la chiave pubblica VAPID generata in Task 9>
```

- [ ] **15.4** Aggiungi `<link rel="manifest">` al layout PWA in `(customer-app)/account/layout.tsx`. Aggiungi dentro `<head>` tramite Next.js metadata export:

```typescript
// In layout.tsx, aggiungi prima del default export:
import type { Metadata } from 'next'

export const metadata: Metadata = {
  manifest: '/manifest.json',
  themeColor: '#0d0d0d',
}
```

- [ ] **15.5** Typecheck finale completo:
```bash
cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
```

- [ ] **15.6** Commit:
```bash
git add storefront/src/app/\(customer-app\)/account/profilo/
git commit -m "feat(pwa): add Profilo page with level, style, locale, push notifications"
```

---

## Task 16: Deploy e smoke test

- [ ] **16.1** Push su main per triggherare deploy Railway:
```bash
git push origin main
```

- [ ] **16.2** Verifica build su Railway:
```bash
railway logs --tail 30
```
Expected: `Ready on port XXXX`, nessun errore TypeScript o import missing.

- [ ] **16.3** Smoke test manuale:
1. Apri `https://thefoolishbutcher.com/account/login`
2. Inserisci un'email che ha almeno un ordine nel sistema
3. Controlla email → clicca link magic
4. Verifica redirect su `/account` con Home personale
5. Naviga su Ordini, Collezione, File, Profilo
6. In Profilo, attiva push notifiche
7. Dal CMS: modifica un ordine aggiungendo un tracking number → verifica email arriva al cliente

- [ ] **16.4** Verifica installabilità PWA:
1. Apri Chrome DevTools → Lighthouse → PWA audit
2. Expected: nessun errore bloccante su manifest e service worker

- [ ] **16.5** Commit finale se ci sono fix minori dal testing:
```bash
git add -A
git commit -m "fix(pwa): smoke test fixes"
```

---

## Note implementative

- **`updateSubscriberProfile`** usa `sql.unsafe()` per i campi dinamici — alternativa più sicura: usare un approccio con query separate per ogni campo. Se si preferisce evitare `unsafe`, sostituire con query esplicite per ogni combinazione.
- **Nomi prodotti in Collezione**: il filtro per formato (`A4`, `A5`, `XXL`) è derivato da `lineItems[0].variantLabel`. Se i prodotti non hanno `variantLabel` o il formato non è nel label, tutti i fogli cadono nella categoria "Altro". Da verificare con i dati reali.
- **`NEXT_PUBLIC_CMS_URL`**: se questa env var non è definita, cade su `PAYLOAD_PUBLIC_URL`. Verificare che sia impostata sullo storefront Railway.
- **CustomerFiles access**: la route API `/api/customer-files` è protetta da `x-storefront-secret`. Il `FilePage` server component usa questa chiave — non è esposta al client.
