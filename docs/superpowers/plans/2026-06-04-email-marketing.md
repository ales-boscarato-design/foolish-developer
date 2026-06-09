# Email Marketing Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete email marketing automation: subscriber capture, 4 automated flows (welcome, abandoned cart, review request, re-engagement), React Email templates, cron routes secured with CRON_SECRET, and Frank webhook notifications.

**Architecture:** Subscribers stored in Railway PostgreSQL `marketing.*` schema accessed directly from Next.js API routes via `postgres` npm package. Emails sent via Resend SDK using React Email templates. Cron routes called by Railway scheduler every 15 min / 1 hour / weekly. Unsubscribe via signed JWT (jose). Bounce handling via Resend webhook.

**Tech Stack:** Next.js 16.2.4 App Router, `postgres` (porsager), `resend`, `@react-email/components`, `jose`, `svix`

---

## File Map

**New files:**
- `storefront/scripts/migrate-marketing.sql` — DB schema migration (run once via Railway)
- `storefront/src/lib/db.ts` — PostgreSQL singleton connection
- `storefront/src/lib/marketing-db.ts` — marketing schema query helpers
- `storefront/src/lib/resend.ts` — Resend client + send helpers
- `storefront/emails/it.json` — master copy (Alessandro fills/edits)
- `storefront/emails/en.json` — Frank translates
- `storefront/emails/de.json` — Frank translates
- `storefront/emails/es.json` — Frank translates
- `storefront/emails/fr.json` — Frank translates
- `storefront/src/emails/welcome.tsx` — React Email welcome template
- `storefront/src/emails/abandoned-cart.tsx` — React Email abandoned cart template
- `storefront/src/emails/review-request.tsx` — React Email review request template
- `storefront/src/emails/reengagement.tsx` — React Email re-engagement template
- `storefront/src/app/api/email/cart-session/route.ts` — save cart session
- `storefront/src/app/api/email/unsubscribe/route.ts` — JWT unsubscribe
- `storefront/src/app/api/email/resend-webhook/route.ts` — bounce/complaint handling
- `storefront/src/app/api/cron/abandoned-cart/route.ts` — cron: abandoned cart emails
- `storefront/src/app/api/cron/review-request/route.ts` — cron: review request emails
- `storefront/src/app/api/cron/reengagement/route.ts` — cron: re-engagement emails

**Modified files:**
- `storefront/src/app/api/webhook/stripe/route.ts` — add subscriber upsert + welcome email
- `storefront/src/app/[locale]/checkout/page.tsx` — add cart session debounce

---

### Task 1: Install dependencies

**Files:**
- Modify: `storefront/package.json` (via npm install)

- [ ] **Step 1: Install packages**

```bash
cd storefront
npm install resend @react-email/components postgres jose svix
```

- [ ] **Step 2: Verify install**

```bash
cat package.json | grep -E '"resend|react-email|postgres|jose|svix'
```

Expected output: all 5 packages present with versions.

- [ ] **Step 3: Commit**

```bash
git add storefront/package.json storefront/package-lock.json
git commit -m "feat(email): install resend, react-email, postgres, jose, svix"
```

---

### Task 2: DB migration

**Files:**
- Create: `storefront/scripts/migrate-marketing.sql`

- [ ] **Step 1: Write migration script**

Create `storefront/scripts/migrate-marketing.sql`:

```sql
-- Marketing schema — run once via Railway Postgres shell
-- Connect: railway connect postgres (or via Railway dashboard → Data → Query)

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE IF NOT EXISTS marketing.subscribers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    locale          TEXT NOT NULL DEFAULT 'it',
    source          TEXT NOT NULL DEFAULT 'purchase',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unsubscribed', 'bounced', 'inactive')),
    purchase_count  INTEGER NOT NULL DEFAULT 0,
    total_spent     NUMERIC(10,2) NOT NULL DEFAULT 0,
    last_purchase_at TIMESTAMPTZ,
    categories      TEXT[] NOT NULL DEFAULT '{}',
    unsubscribed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscribers_status ON marketing.subscribers(status);
CREATE INDEX IF NOT EXISTS idx_subscribers_last_purchase ON marketing.subscribers(last_purchase_at);
CREATE INDEX IF NOT EXISTS idx_subscribers_email ON marketing.subscribers(email);

CREATE TABLE IF NOT EXISTS marketing.cart_sessions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                TEXT,
    cart_data            JSONB NOT NULL,
    checkout_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email_sent_at        TIMESTAMPTZ,
    recovered_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cart_sessions_email ON marketing.cart_sessions(email);
CREATE INDEX IF NOT EXISTS idx_cart_sessions_pending ON marketing.cart_sessions(checkout_started_at)
    WHERE email_sent_at IS NULL AND recovered_at IS NULL;

CREATE TABLE IF NOT EXISTS marketing.email_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id  UUID REFERENCES marketing.subscribers(id),
    email          TEXT NOT NULL,
    type           TEXT NOT NULL
                   CHECK (type IN ('welcome', 'abandoned_cart', 'review_request', 'reengagement')),
    resend_id      TEXT,
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_log_subscriber ON marketing.email_log(subscriber_id);
CREATE INDEX IF NOT EXISTS idx_email_log_type ON marketing.email_log(type);
CREATE INDEX IF NOT EXISTS idx_email_log_sent_at ON marketing.email_log(sent_at);

-- Add review_email_sent_at to existing foolish.orders table
ALTER TABLE foolish.orders ADD COLUMN IF NOT EXISTS review_email_sent_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_review_email ON foolish.orders(delivered_at)
    WHERE review_email_sent_at IS NULL;
```

- [ ] **Step 2: Run migration via Railway**

```bash
# Option A — Railway CLI
railway connect postgres
# Then paste the SQL from the file

# Option B — psql direct
psql "$DATABASE_URL" -f scripts/migrate-marketing.sql
```

Expected: all CREATE TABLE/INDEX succeed (IF NOT EXISTS = safe to re-run).

- [ ] **Step 3: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'marketing';
-- Expected: subscribers, cart_sessions, email_log

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'foolish' AND table_name = 'orders' AND column_name = 'review_email_sent_at';
-- Expected: 1 row
```

- [ ] **Step 4: Commit migration script**

```bash
git add storefront/scripts/migrate-marketing.sql
git commit -m "feat(email): add marketing schema migration script"
```

---

### Task 3: PostgreSQL connection client

**Files:**
- Create: `storefront/src/lib/db.ts`

- [ ] **Step 1: Create DB singleton**

Create `storefront/src/lib/db.ts`:

```typescript
import postgres from 'postgres'

declare global {
  // eslint-disable-next-line no-var
  var _sqlConn: ReturnType<typeof postgres> | undefined
}

// Singleton: reuse connection across hot-reloads in dev
const sql = globalThis._sqlConn ?? postgres(process.env.DATABASE_URL!, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
})

if (process.env.NODE_ENV !== 'production') {
  globalThis._sqlConn = sql
}

export default sql
```

- [ ] **Step 2: Add DATABASE_URL to Railway env**

In Railway dashboard → foolish-storefront service → Variables:
```
DATABASE_URL=<same postgres connection string used by Payload CMS>
```

Also add to local `.env.local` for development:
```
DATABASE_URL=postgresql://...
```

- [ ] **Step 3: Commit**

```bash
git add storefront/src/lib/db.ts
git commit -m "feat(email): add postgres connection singleton"
```

---

### Task 4: Marketing DB helpers

**Files:**
- Create: `storefront/src/lib/marketing-db.ts`

- [ ] **Step 1: Write marketing-db.ts**

Create `storefront/src/lib/marketing-db.ts`:

```typescript
import sql from './db'

export type EmailType = 'welcome' | 'abandoned_cart' | 'review_request' | 'reengagement'

export interface Subscriber {
  id: string
  email: string
  name: string | null
  locale: string
  status: string
  purchase_count: number
  total_spent: number
  last_purchase_at: Date | null
}

export interface AbandonedCart {
  id: string
  email: string
  cart_data: unknown
  checkout_started_at: Date
}

export interface OrderForReview {
  id: string // WooCommerce order id (bigint → string)
  customer_email: string
  customer_name: string | null
  subscriber_status: string | null
}

// Upsert subscriber from a purchase. Returns { id, isNew }.
// isNew = true when purchase_count was 0 before this upsert (→ send welcome email).
export async function upsertSubscriber(params: {
  email: string
  name: string | null
  locale: string
  amountEur: number
}): Promise<{ id: string; isNew: boolean }> {
  const { email, name, locale, amountEur } = params

  const rows = await sql<{ id: string; purchase_count: number }[]>`
    INSERT INTO marketing.subscribers (email, name, locale, source, purchase_count, total_spent, last_purchase_at)
    VALUES (${email}, ${name}, ${locale}, 'purchase', 1, ${amountEur}, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name            = COALESCE(EXCLUDED.name, marketing.subscribers.name),
      purchase_count  = marketing.subscribers.purchase_count + 1,
      total_spent     = marketing.subscribers.total_spent + ${amountEur},
      last_purchase_at = NOW(),
      updated_at      = NOW()
    RETURNING id, purchase_count
  `

  const row = rows[0]
  // isNew = true when purchase_count is exactly 1 after upsert
  return { id: row.id, isNew: row.purchase_count === 1 }
}

// Upsert cart session — one open session per email (latest wins).
export async function saveCartSession(email: string, cartData: unknown): Promise<void> {
  await sql`
    INSERT INTO marketing.cart_sessions (email, cart_data, checkout_started_at)
    VALUES (${email}, ${sql.json(cartData as object)}, NOW())
    ON CONFLICT DO NOTHING
  `
  // Update existing open session for this email
  await sql`
    UPDATE marketing.cart_sessions
    SET cart_data = ${sql.json(cartData as object)},
        checkout_started_at = NOW()
    WHERE email = ${email}
      AND email_sent_at IS NULL
      AND recovered_at IS NULL
  `
}

// Mark cart as recovered (purchase completed).
export async function markCartSessionRecovered(email: string): Promise<void> {
  await sql`
    UPDATE marketing.cart_sessions
    SET recovered_at = NOW()
    WHERE email = ${email}
      AND recovered_at IS NULL
  `
}

// Log an email send.
export async function logEmail(params: {
  email: string
  type: EmailType
  resendId: string
  subscriberId?: string
}): Promise<void> {
  const { email, type, resendId, subscriberId } = params
  await sql`
    INSERT INTO marketing.email_log (email, type, resend_id, subscriber_id)
    VALUES (${email}, ${type}, ${resendId}, ${subscriberId ?? null})
  `
}

// Abandoned carts: started 1+ hour ago, no email sent, not recovered.
export async function getAbandonedCarts(): Promise<AbandonedCart[]> {
  return sql<AbandonedCart[]>`
    SELECT id, email, cart_data, checkout_started_at
    FROM marketing.cart_sessions
    WHERE checkout_started_at <= NOW() - INTERVAL '1 hour'
      AND email_sent_at IS NULL
      AND recovered_at IS NULL
      AND email IS NOT NULL
  `
}

// Mark abandoned cart email as sent.
export async function markCartEmailSent(id: string): Promise<void> {
  await sql`
    UPDATE marketing.cart_sessions
    SET email_sent_at = NOW()
    WHERE id = ${id}
  `
}

// Check if subscriber is blocked (unsubscribed or bounced).
export async function isSubscriberBlocked(email: string): Promise<boolean> {
  const rows = await sql<{ status: string }[]>`
    SELECT status FROM marketing.subscribers WHERE email = ${email} LIMIT 1
  `
  if (rows.length === 0) return false
  return rows[0].status === 'unsubscribed' || rows[0].status === 'bounced'
}

// Orders delivered 7+ days ago with no review email, customer not blocked.
export async function getOrdersForReview(): Promise<OrderForReview[]> {
  return sql<OrderForReview[]>`
    SELECT
      o.id::text,
      o.customer_email,
      o.customer_name,
      s.status as subscriber_status
    FROM foolish.orders o
    LEFT JOIN marketing.subscribers s ON s.email = o.customer_email
    WHERE o.delivered_at <= NOW() - INTERVAL '7 days'
      AND o.review_email_sent_at IS NULL
      AND o.customer_email IS NOT NULL
      AND (s.status IS NULL OR s.status = 'active')
  `
}

// Mark review email as sent on the order.
export async function markReviewEmailSent(orderId: string): Promise<void> {
  await sql`
    UPDATE foolish.orders
    SET review_email_sent_at = NOW()
    WHERE id = ${orderId}::bigint
  `
}

// Active subscribers with no purchase in 90 days and no email in last 30 days.
export async function getInactiveSubscribers(limit = 100): Promise<Subscriber[]> {
  return sql<Subscriber[]>`
    SELECT s.*
    FROM marketing.subscribers s
    WHERE s.status = 'active'
      AND s.last_purchase_at <= NOW() - INTERVAL '90 days'
      AND NOT EXISTS (
        SELECT 1 FROM marketing.email_log el
        WHERE el.subscriber_id = s.id
          AND el.sent_at >= NOW() - INTERVAL '30 days'
      )
    LIMIT ${limit}
  `
}

// Get subscriber by ID (for unsubscribe flow).
export async function getSubscriberById(id: string): Promise<Subscriber | null> {
  const rows = await sql<Subscriber[]>`
    SELECT * FROM marketing.subscribers WHERE id = ${id} LIMIT 1
  `
  return rows[0] ?? null
}

// Unsubscribe: set status = 'unsubscribed'.
export async function unsubscribeById(id: string): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET status = 'unsubscribed', unsubscribed_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
  `
}

// Bounce: set status = 'bounced' by email.
export async function bounceByEmail(email: string): Promise<void> {
  await sql`
    UPDATE marketing.subscribers
    SET status = 'bounced', updated_at = NOW()
    WHERE email = ${email}
  `
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd storefront && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors from `marketing-db.ts`.

- [ ] **Step 3: Commit**

```bash
git add storefront/src/lib/marketing-db.ts
git commit -m "feat(email): marketing DB query helpers"
```

---

### Task 5: Resend client and send helpers

**Files:**
- Create: `storefront/src/lib/resend.ts`

- [ ] **Step 1: Write resend.ts**

Create `storefront/src/lib/resend.ts`:

```typescript
import { Resend } from 'resend'
import { SignJWT } from 'jose'
import { WelcomeEmail } from '@/emails/welcome'
import { AbandonedCartEmail } from '@/emails/abandoned-cart'
import { ReviewRequestEmail } from '@/emails/review-request'
import { ReengagementEmail } from '@/emails/reengagement'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM = process.env.RESEND_FROM || 'The Foolish Butcher <noreply@thefoolishbutcher.com>'
const SITE = 'https://thefoolishbutcher.com'

// Map shipping country → locale
export function countryToLocale(country: string | null | undefined): string {
  if (!country) return 'it'
  const c = country.toUpperCase()
  if (c === 'IT') return 'it'
  if (['DE', 'AT', 'CH'].includes(c)) return 'de'
  if (['FR', 'BE', 'LU'].includes(c)) return 'fr'
  if (['ES'].includes(c)) return 'es'
  return 'en'
}

// Generate a signed JWT for unsubscribe links (30-day expiry).
export async function generateUnsubscribeToken(subscriberId: string, email: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_SECRET!)
  return new SignJWT({ subscriberId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret)
}

function unsubscribeUrl(token: string): string {
  return `${SITE}/api/email/unsubscribe?token=${token}`
}

export async function sendWelcomeEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('welcome', params.locale),
    react: WelcomeEmail({
      name: params.name,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
    }),
  })
  if (error) throw new Error(`Resend welcome error: ${error.message}`)
  return data!.id
}

export async function sendAbandonedCartEmail(params: {
  to: string
  cartData: unknown
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('abandoned_cart', params.locale),
    react: AbandonedCartEmail({
      cartData: params.cartData,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
      checkoutUrl: `${SITE}/checkout`,
    }),
  })
  if (error) throw new Error(`Resend abandoned_cart error: ${error.message}`)
  return data!.id
}

export async function sendReviewRequestEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    replyTo: 'alessandro@thefoolishbutcher.com',
    subject: getSubject('review_request', params.locale),
    react: ReviewRequestEmail({
      name: params.name,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
    }),
  })
  if (error) throw new Error(`Resend review_request error: ${error.message}`)
  return data!.id
}

export async function sendReengagementEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('reengagement', params.locale),
    react: ReengagementEmail({
      name: params.name,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
      shopUrl: SITE,
    }),
  })
  if (error) throw new Error(`Resend reengagement error: ${error.message}`)
  return data!.id
}

// Notify Frank after each cron run.
export async function notifyFrank(payload: {
  cron: string
  sent: number
  recipients: string[]
  errors: string[]
}): Promise<void> {
  const url = process.env.FRANK_WEBHOOK_URL
  if (!url) return
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => console.error('Frank notify failed:', e))
}

// Helper: read subject line from locale copy.
function getSubject(type: string, locale: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let copy: Record<string, Record<string, string>>
  try {
    copy = require(`../../../emails/${locale}.json`)
  } catch {
    copy = require('../../../emails/it.json')
  }
  return copy[type]?.subject ?? '— The Foolish Butcher'
}
```

- [ ] **Step 2: Add env vars to Railway**

In Railway dashboard → Variables, add:
```
RESEND_API_KEY=re_...
RESEND_FROM=The Foolish Butcher <noreply@thefoolishbutcher.com>
RESEND_WEBHOOK_SECRET=whsec_...
CRON_SECRET=<generate: openssl rand -hex 32>
UNSUBSCRIBE_SECRET=<generate: openssl rand -hex 32>
FRANK_WEBHOOK_URL=<agentmail.to webhook URL from Frank config>
```

Also add to local `.env.local`.

- [ ] **Step 3: Commit**

```bash
git add storefront/src/lib/resend.ts
git commit -m "feat(email): resend client, send helpers, Frank notify"
```

---

### Task 6: Email copy JSON files

**Files:**
- Create: `storefront/emails/it.json`
- Create: `storefront/emails/en.json`
- Create: `storefront/emails/de.json`
- Create: `storefront/emails/es.json`
- Create: `storefront/emails/fr.json`

- [ ] **Step 1: Create Italian master copy**

Create `storefront/emails/it.json` (Alessandro fills/edits the copy):

```json
{
  "welcome": {
    "subject": "Grazie — il tuo ordine è confermato",
    "preview": "Produzione artigianale su ordinazione.",
    "heading": "Ordine ricevuto.",
    "body": "Produzione artigianale su ordinazione. Ogni foglio che faccio è unico — nessuna ripetizione. Ti scrivo non appena è pronto, con le foto di quello che ti sto per spedire.",
    "cta": "Torna al sito",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "abandoned_cart": {
    "subject": "Hai lasciato qualcosa nel carrello",
    "preview": "Produco su ordinazione — i posti non durano.",
    "heading": "Ancora lì?",
    "body": "Hai lasciato dei prodotti nel carrello. Produco su ordinazione: quando finisco un lotto mi fermo. Se ti interessa ancora, meglio fare in fretta.",
    "cta": "Completa l'ordine",
    "footer_note": "Produzione artigianale — ogni foglio è irripetibile."
  },
  "review_request": {
    "subject": "Com'è arrivato?",
    "preview": "Il tuo ordine è arrivato qualche giorno fa.",
    "heading": "Fammi sapere.",
    "body": "Il tuo ordine è arrivato qualche giorno fa. Hai già provato a tatuarci sopra? Ogni feedback mi serve per migliorare il prossimo lotto — rispondi direttamente a questa email.",
    "cta": "Rispondi a questa email"
  },
  "reengagement": {
    "subject": "Sono ancora qui.",
    "preview": "Non ci sentiamo da un po'.",
    "heading": "Non sparire.",
    "body": "Non ci sentiamo da un po'. Quando sei pronto a ordinare di nuovo, ci sono — nel frattempo continuo a produrre e migliorare.",
    "cta": "Scopri le novità",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "footer": {
    "unsubscribe_text": "Non vuoi più ricevere email?",
    "unsubscribe_cta": "Cancella iscrizione",
    "site": "thefoolishbutcher.com"
  }
}
```

- [ ] **Step 2: Create EN/DE/ES/FR placeholder copies**

Create `storefront/emails/en.json` (Frank translates — placeholder for now):

```json
{
  "welcome": {
    "subject": "Thank you — your order is confirmed",
    "preview": "Handcrafted, made to order.",
    "heading": "Order received.",
    "body": "Handcrafted, made to order. Every sheet I make is unique — no two are the same. I'll write to you as soon as it's ready, with photos of exactly what I'm sending you.",
    "cta": "Back to the site",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "abandoned_cart": {
    "subject": "You left something in your cart",
    "preview": "Made to order — spots don't last.",
    "heading": "Still there?",
    "body": "You left some items in your cart. I produce to order: when a batch is done, it's done. If you're still interested, sooner is better.",
    "cta": "Complete your order",
    "footer_note": "Handcrafted production — every sheet is one of a kind."
  },
  "review_request": {
    "subject": "How did it arrive?",
    "preview": "Your order arrived a few days ago.",
    "heading": "Let me know.",
    "body": "Your order arrived a few days ago. Have you tried tattooing on it yet? Every bit of feedback helps me improve the next batch — just reply to this email.",
    "cta": "Reply to this email"
  },
  "reengagement": {
    "subject": "Still here.",
    "preview": "It's been a while.",
    "heading": "Don't disappear.",
    "body": "It's been a while. Whenever you're ready to order again, I'm here — in the meantime I keep producing and improving.",
    "cta": "See what's new",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "footer": {
    "unsubscribe_text": "Don't want to receive emails anymore?",
    "unsubscribe_cta": "Unsubscribe",
    "site": "thefoolishbutcher.com"
  }
}
```

Create `storefront/emails/de.json`:

```json
{
  "welcome": {
    "subject": "Danke — deine Bestellung ist bestätigt",
    "preview": "Handgefertigt auf Bestellung.",
    "heading": "Bestellung eingegangen.",
    "body": "Handgefertigt auf Bestellung. Jede Lage, die ich herstelle, ist einzigartig — keine zwei sind gleich. Ich melde mich, sobald sie fertig ist, mit Fotos von genau dem, was ich dir schicke.",
    "cta": "Zurück zur Website",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "abandoned_cart": {
    "subject": "Du hast etwas im Warenkorb gelassen",
    "preview": "Auf Bestellung gefertigt — Plätze sind begrenzt.",
    "heading": "Noch da?",
    "body": "Du hast einige Artikel im Warenkorb gelassen. Ich produziere auf Bestellung: wenn eine Charge fertig ist, ist sie weg. Falls du noch interessiert bist, besser bald.",
    "cta": "Bestellung abschließen",
    "footer_note": "Handwerkliche Produktion — jede Lage ist einzigartig."
  },
  "review_request": {
    "subject": "Wie ist es angekommen?",
    "preview": "Deine Bestellung ist vor ein paar Tagen angekommen.",
    "heading": "Lass es mich wissen.",
    "body": "Deine Bestellung ist vor ein paar Tagen angekommen. Hast du schon darauf tätowiert? Jedes Feedback hilft mir, die nächste Charge zu verbessern — antworte einfach auf diese E-Mail.",
    "cta": "Auf diese E-Mail antworten"
  },
  "reengagement": {
    "subject": "Noch hier.",
    "preview": "Es ist eine Weile her.",
    "heading": "Verschwinde nicht.",
    "body": "Es ist eine Weile her. Wann immer du wieder bestellen möchtest, bin ich da — in der Zwischenzeit produziere und verbessere ich weiter.",
    "cta": "Neuheiten entdecken",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "footer": {
    "unsubscribe_text": "Keine E-Mails mehr erhalten?",
    "unsubscribe_cta": "Abmelden",
    "site": "thefoolishbutcher.com"
  }
}
```

Create `storefront/emails/es.json`:

```json
{
  "welcome": {
    "subject": "Gracias — tu pedido está confirmado",
    "preview": "Hecho a mano, bajo pedido.",
    "heading": "Pedido recibido.",
    "body": "Hecho a mano, bajo pedido. Cada lámina que hago es única — no hay dos iguales. Te escribo en cuanto esté lista, con fotos de exactamente lo que te voy a enviar.",
    "cta": "Volver al sitio",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "abandoned_cart": {
    "subject": "Dejaste algo en el carrito",
    "preview": "Producción bajo pedido — las plazas no duran.",
    "heading": "¿Sigues ahí?",
    "body": "Dejaste algunos productos en el carrito. Produzco bajo pedido: cuando termino un lote, se acaba. Si todavía te interesa, mejor no esperar.",
    "cta": "Completar el pedido",
    "footer_note": "Producción artesanal — cada lámina es irrepetible."
  },
  "review_request": {
    "subject": "¿Cómo llegó?",
    "preview": "Tu pedido llegó hace unos días.",
    "heading": "Cuéntame.",
    "body": "Tu pedido llegó hace unos días. ¿Ya has tatuado sobre él? Cualquier opinión me ayuda a mejorar el próximo lote — responde directamente a este correo.",
    "cta": "Responder a este correo"
  },
  "reengagement": {
    "subject": "Sigo aquí.",
    "preview": "Ha pasado un tiempo.",
    "heading": "No desaparezcas.",
    "body": "Ha pasado un tiempo. Cuando estés listo para volver a pedir, aquí estoy — mientras tanto sigo produciendo y mejorando.",
    "cta": "Ver las novedades",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "footer": {
    "unsubscribe_text": "¿No quieres recibir más correos?",
    "unsubscribe_cta": "Cancelar suscripción",
    "site": "thefoolishbutcher.com"
  }
}
```

Create `storefront/emails/fr.json`:

```json
{
  "welcome": {
    "subject": "Merci — votre commande est confirmée",
    "preview": "Fait main, sur commande.",
    "heading": "Commande reçue.",
    "body": "Fait main, sur commande. Chaque feuille que je fabrique est unique — aucune n'est identique. Je vous écris dès qu'elle est prête, avec des photos de ce que je vous envoie.",
    "cta": "Retour au site",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "abandoned_cart": {
    "subject": "Vous avez laissé quelque chose dans votre panier",
    "preview": "Production sur commande — les places ne durent pas.",
    "heading": "Toujours là ?",
    "body": "Vous avez laissé des produits dans votre panier. Je produis sur commande : quand un lot est terminé, c'est terminé. Si vous êtes toujours intéressé, mieux vaut ne pas attendre.",
    "cta": "Finaliser la commande",
    "footer_note": "Production artisanale — chaque feuille est unique."
  },
  "review_request": {
    "subject": "Comment est-il arrivé ?",
    "preview": "Votre commande est arrivée il y a quelques jours.",
    "heading": "Dites-moi.",
    "body": "Votre commande est arrivée il y a quelques jours. Avez-vous déjà tatoué dessus ? Chaque retour m'aide à améliorer le prochain lot — répondez directement à cet email.",
    "cta": "Répondre à cet email"
  },
  "reengagement": {
    "subject": "Je suis toujours là.",
    "preview": "Ça fait un moment.",
    "heading": "Ne disparaissez pas.",
    "body": "Ça fait un moment. Quand vous êtes prêt à commander à nouveau, je suis là — en attendant, je continue à produire et à m'améliorer.",
    "cta": "Voir les nouveautés",
    "cta_url": "https://thefoolishbutcher.com"
  },
  "footer": {
    "unsubscribe_text": "Vous ne souhaitez plus recevoir d'emails ?",
    "unsubscribe_cta": "Se désabonner",
    "site": "thefoolishbutcher.com"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add storefront/emails/
git commit -m "feat(email): email copy JSON for all 5 locales (IT master + 4 translations)"
```

---

### Task 7: Email templates (React Email)

**Files:**
- Create: `storefront/src/emails/welcome.tsx`
- Create: `storefront/src/emails/abandoned-cart.tsx`
- Create: `storefront/src/emails/review-request.tsx`
- Create: `storefront/src/emails/reengagement.tsx`

These are **shared layout** across all templates. Define the shared structure inline in each (no abstraction needed for 4 templates).

**Palette:** bg `#0a0a0a`, text `#f0ede8`, accent `#c8a97e`, muted `#6b6560`

- [ ] **Step 1: Create welcome template**

Create `storefront/src/emails/welcome.tsx`:

```tsx
import {
  Html, Head, Body, Container, Section, Text, Button, Hr, Preview,
} from '@react-email/components'

interface Props {
  name: string | null
  locale: string
  unsubscribeUrl: string
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
function getCopy(locale: string) {
  try { return require(`../../../emails/${locale}.json`).welcome }
  catch { return require('../../../emails/it.json').welcome }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getFooter(locale: string) {
  try { return require(`../../../emails/${locale}.json`).footer }
  catch { return require('../../../emails/it.json').footer }
}

export function WelcomeEmail({ name, locale, unsubscribeUrl }: Props) {
  const copy = getCopy(locale)
  const footer = getFooter(locale)
  const greeting = name ? name.split(' ')[0] : null

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#0a0a0a', fontFamily: 'Georgia, serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 24px' }}>
          {/* Wordmark */}
          <Section>
            <Text style={{ color: '#c8a97e', fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 24px' }}>
              The Foolish Butcher
            </Text>
          </Section>

          {/* Gold separator */}
          <Hr style={{ borderColor: '#c8a97e', borderWidth: '1px', margin: '0 0 32px' }} />

          {/* Body */}
          <Section>
            {greeting && (
              <Text style={{ color: '#f0ede8', fontSize: '16px', margin: '0 0 8px' }}>
                {greeting},
              </Text>
            )}
            <Text style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 'bold', margin: '0 0 20px', lineHeight: '1.3' }}>
              {copy.heading}
            </Text>
            <Text style={{ color: '#f0ede8', fontSize: '15px', lineHeight: '1.7', margin: '0 0 32px' }}>
              {copy.body}
            </Text>

            <Button
              href={copy.cta_url}
              style={{
                backgroundColor: '#c8a97e',
                color: '#080808',
                padding: '14px 28px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.06em',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              {copy.cta}
            </Button>
          </Section>

          {/* Footer */}
          <Hr style={{ borderColor: '#2a2a2a', borderWidth: '1px', margin: '40px 0 20px' }} />
          <Section>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: '0 0 4px' }}>
              {footer.site}
            </Text>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: 0 }}>
              {footer.unsubscribe_text}{' '}
              <a href={unsubscribeUrl} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                {footer.unsubscribe_cta}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default WelcomeEmail
```

- [ ] **Step 2: Create abandoned-cart template**

Create `storefront/src/emails/abandoned-cart.tsx`:

```tsx
import {
  Html, Head, Body, Container, Section, Text, Button, Hr, Preview,
} from '@react-email/components'

interface CartItem {
  productName: string
  variantLabel: string
  price: number
  quantity: number
}

interface Props {
  cartData: unknown
  locale: string
  unsubscribeUrl: string
  checkoutUrl: string
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
function getCopy(locale: string) {
  try { return require(`../../../emails/${locale}.json`).abandoned_cart }
  catch { return require('../../../emails/it.json').abandoned_cart }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getFooter(locale: string) {
  try { return require(`../../../emails/${locale}.json`).footer }
  catch { return require('../../../emails/it.json').footer }
}

export function AbandonedCartEmail({ cartData, locale, unsubscribeUrl, checkoutUrl }: Props) {
  const copy = getCopy(locale)
  const footer = getFooter(locale)
  const items = Array.isArray(cartData) ? (cartData as CartItem[]) : []

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#0a0a0a', fontFamily: 'Georgia, serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 24px' }}>
          <Section>
            <Text style={{ color: '#c8a97e', fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 24px' }}>
              The Foolish Butcher
            </Text>
          </Section>
          <Hr style={{ borderColor: '#c8a97e', borderWidth: '1px', margin: '0 0 32px' }} />

          <Section>
            <Text style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 'bold', margin: '0 0 20px', lineHeight: '1.3' }}>
              {copy.heading}
            </Text>
            <Text style={{ color: '#f0ede8', fontSize: '15px', lineHeight: '1.7', margin: '0 0 24px' }}>
              {copy.body}
            </Text>

            {/* Cart items */}
            {items.length > 0 && (
              <Section style={{ backgroundColor: '#111', borderRadius: '6px', padding: '16px', marginBottom: '28px' }}>
                {items.map((item, i) => (
                  <Text key={i} style={{ color: '#f0ede8', fontSize: '13px', margin: '0 0 6px' }}>
                    {item.productName} — {item.variantLabel} × {item.quantity}
                    <span style={{ color: '#c8a97e' }}> €{(item.price * item.quantity).toFixed(2)}</span>
                  </Text>
                ))}
              </Section>
            )}

            <Button
              href={checkoutUrl}
              style={{
                backgroundColor: '#c8a97e',
                color: '#080808',
                padding: '14px 28px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.06em',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              {copy.cta}
            </Button>

            {copy.footer_note && (
              <Text style={{ color: '#6b6560', fontSize: '12px', marginTop: '24px' }}>
                {copy.footer_note}
              </Text>
            )}
          </Section>

          <Hr style={{ borderColor: '#2a2a2a', borderWidth: '1px', margin: '40px 0 20px' }} />
          <Section>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: '0 0 4px' }}>
              {footer.site}
            </Text>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: 0 }}>
              {footer.unsubscribe_text}{' '}
              <a href={unsubscribeUrl} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                {footer.unsubscribe_cta}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default AbandonedCartEmail
```

- [ ] **Step 3: Create review-request template**

Create `storefront/src/emails/review-request.tsx`:

```tsx
import {
  Html, Head, Body, Container, Section, Text, Hr, Preview,
} from '@react-email/components'

interface Props {
  name: string | null
  locale: string
  unsubscribeUrl: string
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
function getCopy(locale: string) {
  try { return require(`../../../emails/${locale}.json`).review_request }
  catch { return require('../../../emails/it.json').review_request }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getFooter(locale: string) {
  try { return require(`../../../emails/${locale}.json`).footer }
  catch { return require('../../../emails/it.json').footer }
}

export function ReviewRequestEmail({ name, locale, unsubscribeUrl }: Props) {
  const copy = getCopy(locale)
  const footer = getFooter(locale)
  const greeting = name ? name.split(' ')[0] : null

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#0a0a0a', fontFamily: 'Georgia, serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 24px' }}>
          <Section>
            <Text style={{ color: '#c8a97e', fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 24px' }}>
              The Foolish Butcher
            </Text>
          </Section>
          <Hr style={{ borderColor: '#c8a97e', borderWidth: '1px', margin: '0 0 32px' }} />

          <Section>
            {greeting && (
              <Text style={{ color: '#f0ede8', fontSize: '16px', margin: '0 0 8px' }}>
                {greeting},
              </Text>
            )}
            <Text style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 'bold', margin: '0 0 20px', lineHeight: '1.3' }}>
              {copy.heading}
            </Text>
            <Text style={{ color: '#f0ede8', fontSize: '15px', lineHeight: '1.7', margin: '0 0 32px' }}>
              {copy.body}
            </Text>
            {/* No CTA button — reply-to directs responses to Alessandro */}
            <Text style={{ color: '#6b6560', fontSize: '13px', fontStyle: 'italic' }}>
              — Alessandro, The Foolish Butcher
            </Text>
          </Section>

          <Hr style={{ borderColor: '#2a2a2a', borderWidth: '1px', margin: '40px 0 20px' }} />
          <Section>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: '0 0 4px' }}>
              {footer.site}
            </Text>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: 0 }}>
              {footer.unsubscribe_text}{' '}
              <a href={unsubscribeUrl} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                {footer.unsubscribe_cta}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default ReviewRequestEmail
```

- [ ] **Step 4: Create re-engagement template**

Create `storefront/src/emails/reengagement.tsx`:

```tsx
import {
  Html, Head, Body, Container, Section, Text, Button, Hr, Preview,
} from '@react-email/components'

interface Props {
  name: string | null
  locale: string
  unsubscribeUrl: string
  shopUrl: string
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
function getCopy(locale: string) {
  try { return require(`../../../emails/${locale}.json`).reengagement }
  catch { return require('../../../emails/it.json').reengagement }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getFooter(locale: string) {
  try { return require(`../../../emails/${locale}.json`).footer }
  catch { return require('../../../emails/it.json').footer }
}

export function ReengagementEmail({ name, locale, unsubscribeUrl, shopUrl }: Props) {
  const copy = getCopy(locale)
  const footer = getFooter(locale)
  const greeting = name ? name.split(' ')[0] : null

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#0a0a0a', fontFamily: 'Georgia, serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 24px' }}>
          <Section>
            <Text style={{ color: '#c8a97e', fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 24px' }}>
              The Foolish Butcher
            </Text>
          </Section>
          <Hr style={{ borderColor: '#c8a97e', borderWidth: '1px', margin: '0 0 32px' }} />

          <Section>
            {greeting && (
              <Text style={{ color: '#f0ede8', fontSize: '16px', margin: '0 0 8px' }}>
                {greeting},
              </Text>
            )}
            <Text style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 'bold', margin: '0 0 20px', lineHeight: '1.3' }}>
              {copy.heading}
            </Text>
            <Text style={{ color: '#f0ede8', fontSize: '15px', lineHeight: '1.7', margin: '0 0 32px' }}>
              {copy.body}
            </Text>

            <Button
              href={copy.cta_url ?? shopUrl}
              style={{
                backgroundColor: '#c8a97e',
                color: '#080808',
                padding: '14px 28px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.06em',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              {copy.cta}
            </Button>
          </Section>

          <Hr style={{ borderColor: '#2a2a2a', borderWidth: '1px', margin: '40px 0 20px' }} />
          <Section>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: '0 0 4px' }}>
              {footer.site}
            </Text>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: 0 }}>
              {footer.unsubscribe_text}{' '}
              <a href={unsubscribeUrl} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                {footer.unsubscribe_cta}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default ReengagementEmail
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd storefront && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors from `src/emails/`.

- [ ] **Step 6: Commit**

```bash
git add storefront/src/emails/ storefront/emails/
git commit -m "feat(email): React Email templates for all 4 flows"
```

---

### Task 8: Cart session endpoint

**Files:**
- Create: `storefront/src/app/api/email/cart-session/route.ts`

- [ ] **Step 1: Write the route**

Create `storefront/src/app/api/email/cart-session/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { saveCartSession } from '@/lib/marketing-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const { email, cartData } = await req.json()

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    if (!Array.isArray(cartData) || cartData.length === 0) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    await saveCartSession(email.toLowerCase().trim(), cartData)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('cart-session error:', err)
    // Never expose DB errors to client
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify endpoint reachable (after deploy or local)**

```bash
curl -X POST http://localhost:3000/api/email/cart-session \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","cartData":[{"productName":"A4","variantLabel":"Standard","price":19.90,"quantity":1}]}'
```

Expected: `{"ok":true}`

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/email/cart-session/
git commit -m "feat(email): POST /api/email/cart-session — save cart for abandoned cart flow"
```

---

### Task 9: Stripe webhook — subscriber upsert + welcome email

**Files:**
- Modify: `storefront/src/app/api/webhook/stripe/route.ts`

The existing webhook already handles `checkout.session.completed`. Add marketing subscriber upsert and welcome email after the CMS order creation.

- [ ] **Step 1: Add marketing logic to Stripe webhook**

In `storefront/src/app/api/webhook/stripe/route.ts`, add this import at the top:

```typescript
import { upsertSubscriber, markCartSessionRecovered, logEmail } from '@/lib/marketing-db'
import { sendWelcomeEmail, countryToLocale } from '@/lib/resend'
```

Then, inside the `if (event.type === 'checkout.session.completed')` block, after the `createOrderInCMS` try/catch and the nanobot notify block, add:

```typescript
    // Marketing: upsert subscriber + welcome email
    const mktEmail = session.customer_email ?? session.customer_details?.email
    if (mktEmail) {
      try {
        const customerName = session.metadata?.customer_name ?? session.customer_details?.name ?? null
        const amountEur = (session.amount_total ?? 0) / 100
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shippingCountry = (session as any).shipping_details?.address?.country
          ?? session.metadata?.customer_country
          ?? null
        const locale = countryToLocale(shippingCountry)

        const { id: subscriberId, isNew } = await upsertSubscriber({
          email: mktEmail,
          name: customerName,
          locale,
          amountEur,
        })

        // Mark any open cart session as recovered
        await markCartSessionRecovered(mktEmail)

        // Welcome email only on first purchase
        if (isNew) {
          const resendId = await sendWelcomeEmail({
            to: mktEmail,
            name: customerName,
            locale,
            subscriberId,
          })
          await logEmail({
            email: mktEmail,
            type: 'welcome',
            resendId,
            subscriberId,
          })
        }
      } catch (err) {
        // Marketing errors must never block Stripe response
        console.error('Marketing upsert/welcome failed:', err)
      }
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd storefront && npx tsc --noEmit 2>&1 | grep "webhook/stripe"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/webhook/stripe/route.ts
git commit -m "feat(email): Stripe webhook — subscriber upsert + welcome email on first purchase"
```

---

### Task 10: Abandoned cart cron

**Files:**
- Create: `storefront/src/app/api/cron/abandoned-cart/route.ts`

- [ ] **Step 1: Write the cron route**

Create `storefront/src/app/api/cron/abandoned-cart/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import {
  getAbandonedCarts,
  markCartEmailSent,
  isSubscriberBlocked,
  logEmail,
  getSubscriberById,
} from '@/lib/marketing-db'
import { sendAbandonedCartEmail, notifyFrank } from '@/lib/resend'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  // Auth check
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const carts = await getAbandonedCarts()
  const recipients: string[] = []
  const errors: string[] = []

  for (const cart of carts) {
    try {
      const email = cart.email!
      const blocked = await isSubscriberBlocked(email)
      if (blocked) continue

      // Get or create subscriber for unsubscribe token
      const subRows = await sql<{ id: string }[]>`
        SELECT id FROM marketing.subscribers WHERE email = ${email} LIMIT 1
      `
      if (subRows.length === 0) continue // no subscriber = never purchased, skip
      const subscriberId = subRows[0].id

      const resendId = await sendAbandonedCartEmail({
        to: email,
        cartData: cart.cart_data,
        locale: 'it', // cart sessions don't store locale — default to it
        subscriberId,
      })

      await markCartEmailSent(cart.id)
      await logEmail({ email, type: 'abandoned_cart', resendId, subscriberId })
      recipients.push(email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${cart.email}: ${msg}`)
      console.error('abandoned-cart cron error:', err)
    }
  }

  await notifyFrank({ cron: 'abandoned_cart', sent: recipients.length, recipients, errors })
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
```

- [ ] **Step 2: Manual test (after deploy)**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-railway-domain>/api/cron/abandoned-cart
```

Expected: `{"ok":true,"sent":0,"errors":[]}`

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/cron/abandoned-cart/
git commit -m "feat(email): GET /api/cron/abandoned-cart — abandoned cart email cron"
```

---

### Task 11: Review request cron

**Files:**
- Create: `storefront/src/app/api/cron/review-request/route.ts`

- [ ] **Step 1: Write the cron route**

Create `storefront/src/app/api/cron/review-request/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getOrdersForReview, markReviewEmailSent, logEmail, getSubscriberById } from '@/lib/marketing-db'
import { sendReviewRequestEmail, notifyFrank } from '@/lib/resend'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orders = await getOrdersForReview()
  const recipients: string[] = []
  const errors: string[] = []

  for (const order of orders) {
    try {
      const email = order.customer_email

      // Get subscriber for locale + unsubscribe token
      const subRows = await sql<{ id: string; locale: string }[]>`
        SELECT id, locale FROM marketing.subscribers WHERE email = ${email} LIMIT 1
      `
      const subscriberId = subRows[0]?.id ?? null
      const locale = subRows[0]?.locale ?? 'it'

      // If no subscriber (never purchased via storefront), skip
      if (!subscriberId) continue

      const resendId = await sendReviewRequestEmail({
        to: email,
        name: order.customer_name,
        locale,
        subscriberId,
      })

      await markReviewEmailSent(order.id)
      await logEmail({ email, type: 'review_request', resendId, subscriberId })
      recipients.push(email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`order ${order.id}: ${msg}`)
      console.error('review-request cron error:', err)
    }
  }

  await notifyFrank({ cron: 'review_request', sent: recipients.length, recipients, errors })
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
```

- [ ] **Step 2: Manual test**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-railway-domain>/api/cron/review-request
```

Expected: `{"ok":true,"sent":0,"errors":[]}`

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/cron/review-request/
git commit -m "feat(email): GET /api/cron/review-request — review request email cron (+7d from delivery)"
```

---

### Task 12: Re-engagement cron

**Files:**
- Create: `storefront/src/app/api/cron/reengagement/route.ts`

- [ ] **Step 1: Write the cron route**

Create `storefront/src/app/api/cron/reengagement/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getInactiveSubscribers, logEmail } from '@/lib/marketing-db'
import { sendReengagementEmail, notifyFrank } from '@/lib/resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subscribers = await getInactiveSubscribers(100)
  const recipients: string[] = []
  const errors: string[] = []

  for (const sub of subscribers) {
    try {
      const resendId = await sendReengagementEmail({
        to: sub.email,
        name: sub.name,
        locale: sub.locale,
        subscriberId: sub.id,
      })

      await logEmail({ email: sub.email, type: 'reengagement', resendId, subscriberId: sub.id })
      recipients.push(sub.email)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${sub.email}: ${msg}`)
      console.error('reengagement cron error:', err)
    }
  }

  await notifyFrank({ cron: 'reengagement', sent: recipients.length, recipients, errors })
  return NextResponse.json({ ok: true, sent: recipients.length, errors })
}
```

- [ ] **Step 2: Manual test**

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-railway-domain>/api/cron/reengagement
```

Expected: `{"ok":true,"sent":0,"errors":[]}`

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/cron/reengagement/
git commit -m "feat(email): GET /api/cron/reengagement — weekly re-engagement email cron (90d inactive)"
```

---

### Task 13: Unsubscribe route (JWT)

**Files:**
- Create: `storefront/src/app/api/email/unsubscribe/route.ts`

- [ ] **Step 1: Write the unsubscribe route**

Create `storefront/src/app/api/email/unsubscribe/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { unsubscribeById, getSubscriberById } from '@/lib/marketing-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  try {
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_SECRET!)
    const { payload } = await jwtVerify(token, secret)

    const subscriberId = payload.subscriberId as string
    const email = payload.email as string

    if (!subscriberId || !email) {
      return new NextResponse('Link non valido.', { status: 400 })
    }

    const subscriber = await getSubscriberById(subscriberId)
    if (!subscriber || subscriber.email !== email) {
      return new NextResponse('Link non valido.', { status: 400 })
    }

    if (subscriber.status === 'unsubscribed') {
      // Already unsubscribed — show success anyway
      return new NextResponse(
        '<html><body style="font-family:Georgia,serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><p style="color:#c8a97e;letter-spacing:.1em;text-transform:uppercase;font-size:12px">The Foolish Butcher</p><h1 style="font-size:24px;margin:16px 0">Già cancellato.</h1><p style="color:#6b6560">Non riceverai altre email da noi.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }

    await unsubscribeById(subscriberId)

    return new NextResponse(
      '<html><body style="font-family:Georgia,serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><p style="color:#c8a97e;letter-spacing:.1em;text-transform:uppercase;font-size:12px">The Foolish Butcher</p><h1 style="font-size:24px;margin:16px 0">Cancellato.</h1><p style="color:#6b6560">Non riceverai altre email da noi. Nessuna conferma richiesta.</p></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )
  } catch {
    return new NextResponse('Link scaduto o non valido.', { status: 400 })
  }
}
```

- [ ] **Step 2: Test unsubscribe flow**

Generate a test token locally:

```typescript
// Run once: node -e "..."
import { SignJWT } from 'jose'
const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_SECRET)
const token = await new SignJWT({ subscriberId: 'test-id', email: 'test@example.com' })
  .setProtectedHeader({ alg: 'HS256' })
  .setExpirationTime('30d')
  .sign(secret)
console.log(token)
```

```bash
curl "http://localhost:3000/api/email/unsubscribe?token=<token>"
```

Expected: HTML page with "Cancellato." or "Link non valido."

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/email/unsubscribe/
git commit -m "feat(email): GET /api/email/unsubscribe — JWT-based one-click unsubscribe"
```

---

### Task 14: Resend bounce webhook

**Files:**
- Create: `storefront/src/app/api/email/resend-webhook/route.ts`

Resend uses Svix for webhook signing. The signing secret starts with `whsec_`.

- [ ] **Step 1: Write the webhook route**

Create `storefront/src/app/api/email/resend-webhook/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { bounceByEmail } from '@/lib/marketing-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    console.error('RESEND_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()

  // Svix signature verification
  const wh = new Webhook(secret)
  try {
    wh.verify(rawBody, {
      'svix-id': req.headers.get('svix-id') ?? '',
      'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
      'svix-signature': req.headers.get('svix-signature') ?? '',
    })
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody) as { type: string; data: { email?: string; to?: string[] } }

  if (event.type === 'email.bounced' || event.type === 'email.complained') {
    const email = event.data.email ?? event.data.to?.[0]
    if (email) {
      await bounceByEmail(email).catch((e) => console.error('bounce update failed:', e))
    }
  }

  return NextResponse.json({ received: true })
}
```

- [ ] **Step 2: Register webhook in Resend dashboard**

In Resend dashboard → Webhooks → Add endpoint:
- URL: `https://<your-railway-domain>/api/email/resend-webhook`
- Events: `email.bounced`, `email.complained`
- Copy the signing secret → add to Railway env as `RESEND_WEBHOOK_SECRET`

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/email/resend-webhook/
git commit -m "feat(email): POST /api/email/resend-webhook — bounce and complaint handling via Svix"
```

---

### Task 15: Checkout page — email debounce

**Files:**
- Modify: `storefront/src/app/[locale]/checkout/page.tsx`

When the user types their email in the checkout form with ≥1 item in cart, capture the cart session for abandoned cart flow. Debounce: 2 seconds after last keystroke.

- [ ] **Step 1: Read checkout page to find email field and useEffect location**

Open `storefront/src/app/[locale]/checkout/page.tsx` and locate:
1. The import section at the top
2. The state declarations (near `const [focusedField, setFocusedField]`)
3. The email input's `onChange` handler

- [ ] **Step 2: Add cart session capture useEffect**

After the existing state declarations, add:

```typescript
// Cart session capture for abandoned cart flow
useEffect(() => {
  if (!form.email || !form.email.includes('@') || items.length === 0) return

  const timer = setTimeout(() => {
    fetch('/api/email/cart-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, cartData: items }),
    }).catch(() => {}) // fire-and-forget, never block checkout
  }, 2000)

  return () => clearTimeout(timer)
}, [form.email, items])
```

This requires `items` from the cart store. Verify that the checkout page already imports `useCart` and destructures `items`:

```typescript
const { items, clear } = useCart()
// If it destructures `items` differently, adjust the useEffect accordingly.
// If `items` is not yet destructured, add it to the existing destructure.
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd storefront && npx tsc --noEmit 2>&1 | grep "checkout/page"
```

Expected: no errors.

- [ ] **Step 4: Manual test**

1. Open checkout page with items in cart
2. Type an email address (wait 2s)
3. Check Railway Postgres: `SELECT * FROM marketing.cart_sessions ORDER BY created_at DESC LIMIT 1;`
4. Expected: row with the typed email and cart JSON

- [ ] **Step 5: Commit**

```bash
git add storefront/src/app/[locale]/checkout/page.tsx
git commit -m "feat(email): checkout email debounce → cart session capture for abandoned cart"
```

---

### Task 16: Railway cron jobs configuration

**Files:**
- No code changes — Railway dashboard configuration

- [ ] **Step 1: Add abandoned-cart cron (every 15 min)**

In Railway dashboard → Cron Jobs → Add Cron Job:

```
Name: abandoned-cart
Schedule: */15 * * * *
Command: curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-railway-domain>/api/cron/abandoned-cart
```

Note: Railway cron jobs need the full URL. Get the service domain from Railway dashboard → Settings → Networking.

- [ ] **Step 2: Add review-request cron (every hour)**

```
Name: review-request
Schedule: 0 * * * *
Command: curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-railway-domain>/api/cron/review-request
```

- [ ] **Step 3: Add re-engagement cron (Mondays 09:00 CET)**

Railway cron uses UTC. CET = UTC+1 (UTC+2 in summer). For 09:00 CET (UTC+1) on Mondays:

```
Name: reengagement
Schedule: 0 8 * * 1
Command: curl -s -H "Authorization: Bearer $CRON_SECRET" https://<your-railway-domain>/api/cron/reengagement
```

(Adjust to `0 7 * * 1` during CEST / summer time UTC+2)

- [ ] **Step 4: Verify crons are active**

In Railway dashboard → Cron Jobs, verify all 3 jobs show as "Active". Trigger one manually to test:

```bash
railway run curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<domain>/api/cron/abandoned-cart
```

Expected: `{"ok":true,"sent":0,"errors":[]}`

- [ ] **Step 5: Commit documentation**

```bash
git add -A
git commit -m "feat(email): complete email marketing infrastructure — all flows, templates, crons"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| `marketing.subscribers` table | Task 2 |
| `marketing.cart_sessions` table | Task 2 |
| `marketing.email_log` table | Task 2 |
| `foolish.orders.review_email_sent_at` | Task 2 |
| DB query helpers | Task 4 |
| Resend client | Task 5 |
| Welcome email — first purchase via Stripe webhook | Task 9 |
| Abandoned cart — client capture (debounce 2s) | Task 15 |
| Abandoned cart cron — every 15 min | Tasks 10, 16 |
| Review request cron — every hour, +7d from delivery | Tasks 11, 16 |
| Re-engagement cron — Monday 09:00, 90d inactive | Tasks 12, 16 |
| Unsubscribe via JWT | Tasks 5, 13 |
| Bounce handling via Resend webhook | Task 14 |
| Frank webhook notification after each cron | Tasks 5, 10, 11, 12 |
| React Email templates (4 flows) | Task 7 |
| Email copy JSON (5 locales) | Task 6 |
| CRON_SECRET auth on all cron routes | Tasks 10, 11, 12 |
| `countryToLocale` mapping | Task 5 |
| Subscriber blocked check (unsubscribed/bounced) | Task 4 (`isSubscriberBlocked`) used in Task 10 |
| Cart session marked recovered on purchase | Task 9 |

**Placeholder scan:** No TBD or TODO in code blocks. All copy is functional Italian (Alessandro can edit `emails/it.json`).

**Type consistency:**
- `EmailType` defined in `marketing-db.ts`, used in `logEmail` across Tasks 9-12 ✓
- `AbandonedCart.id` is `string` (UUID), used in `markCartEmailSent(cart.id)` ✓
- `OrderForReview.id` is `string` cast from bigint, used in `markReviewEmailSent(order.id)` ✓
- `Subscriber.id` is `string` (UUID), used as `subscriberId` in all send calls ✓
- `sendAbandonedCartEmail` locale defaults to `'it'` (cart sessions don't store locale) — documented in comment ✓
