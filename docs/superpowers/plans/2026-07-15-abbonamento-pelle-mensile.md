# Abbonamento Pelle Mensile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire l'abbonamento mensile a due referenze fisse (Tattoo XXL, PMU 3 Visi) con benefici di spedizione/prezzo crescenti via Stripe Subscription Schedules, landing dedicate e gestione in area account.

**Architecture:** Ogni combinazione prodotto×zona è uno Stripe Subscription Schedule a 3 fasi (prezzo pieno → spedizione azzerata/invariata → -10%), costruito da una tabella di configurazione statica in `lib/subscription-plans.ts`. Un nuovo handler nel webhook Stripe esistente crea/aggiorna un record CMS `Subscriptions` ad ogni rinnovo e genera un Order CMS identico a un ordine normale (stesso magazzino). Le landing (`/[locale]/abbonamento`, `/[locale]/abbonamento/[plan]`) e la sezione account (`/account/abbonamento`) sono pagine Next.js che leggono da CMS e Stripe.

**Tech Stack:** Next.js 15 (App Router), Payload CMS 3 (Postgres), Stripe Node SDK v22 (Subscriptions + Subscription Schedules), next-intl.

## Global Constraints

- Spec di riferimento: `docs/superpowers/specs/2026-07-15-abbonamento-pelle-mensile-design.md` — ogni requisito lì elencato deve avere un task corrispondente qui.
- **Nessun test runner esiste in questo repo** (zero file `.test.ts`/`.spec.ts`, nessuno script `test` in `package.json`). Per coerenza con la convenzione di progetto (`CLAUDE.md`: "Typecheck prima di ogni commit"), ogni task verifica con `npx tsc --noEmit` invece di una suite jest/vitest inventata. Dove il comportamento non è verificabile da tipo (webhook, pagine), il task include un passo di verifica manuale esplicito (curl, script node, o browser via preview tool) invece di un test automatico fittizio.
- Zone supportate al lancio: solo `IT` ed `EU` (nessuna referenza a `WORLD` in questa feature).
- Valuta: EUR, hardcoded (nessun altro paese/valuta fuori scope).
- Prima di ogni commit: `cd storefront && npx tsc --noEmit` (e `cd cms && npx tsc --noEmit` per i task CMS) — per la regola del progetto "un push per sessione di lavoro", NON pushare finché non è indicato esplicitamente alla fine del piano.
- **Passo manuale non di codice** (da fare una volta, fuori da questi task): nel Dashboard Stripe, abilitare gli eventi `invoice.payment_succeeded` e `customer.subscription.deleted` sull'endpoint webhook esistente (oggi probabilmente abilitato solo per `checkout.session.completed`). Senza questo, i rinnovi non arriveranno mai al webhook.

---

## File Structure

**CMS (`cms/src/`):**
- `collections/SubscriptionPlans.ts` — nuovo. Config: quale Product del catalogo fornisce foto/descrizione per ogni piano (`tattoo`/`pmu`).
- `collections/Subscriptions.ts` — nuovo. Istanza per-cliente: piano, zona, stato, cicli completati.
- `collections/Orders.ts` — modificato. Aggiunge l'opzione `subscription` al campo `source` esistente (nessun cambio a `lineItems`, che è già `json` schemaless).
- `payload.config.ts` — modificato. Registra le due nuove collection.

**Storefront (`storefront/src/`):**
- `lib/shipping.ts` — modificato. Esporta `EU_COUNTRIES` (oggi privato) per riuso.
- `lib/subscription-plans.ts` — nuovo. Tabella prezzi/benefici a 3 fasi, pura, nessuna dipendenza da Stripe.
- `lib/stripe-subscription-schedule.ts` — nuovo. Converte la tabella in fasi Stripe.
- `app/api/subscribe/checkout/route.ts` — nuovo. Crea la Stripe Checkout Session (mode subscription).
- `app/api/webhook/stripe/route.ts` — modificato. Aggiunge i branch subscription ai tre eventi Stripe.
- `app/api/account/subscription/cancel/route.ts` — nuovo. Cancellazione a fine periodo.
- `app/api/account/subscription/change-zone/route.ts` — nuovo. Cambio zona IT↔EU a metà abbonamento.
- `app/(customer-app)/account/(protected)/abbonamento/page.tsx` — nuovo. UI stato abbonamento nell'account.
- `app/(customer-app)/account/(protected)/abbonamento/_components/CancelSubscriptionButton.tsx` — nuovo.
- `app/(customer-app)/account/(protected)/layout.tsx` — modificato. Aggiunge la voce di nav.
- `components/SubscriptionRoadmap.tsx` — nuovo. Componente roadmap con tab IT/Europa (design approvato).
- `app/[locale]/abbonamento/page.tsx` — nuovo. Hub.
- `app/[locale]/abbonamento/[plan]/page.tsx` — nuovo. Pagina prodotto per `tattoo`/`pmu`.
- `app/[locale]/abbonamento/[plan]/_components/SubscribeCTA.tsx` — nuovo. Client component: selezione zona + avvio checkout.
- `app/[locale]/page.tsx` — modificato. Aggiunge banner CTA verso `/abbonamento`.
- `components/SubscriptionBanner.tsx` — nuovo.
- `messages/{it,en,de,fr,es}.json` — modificati. Nuovo namespace `subscription`.

---

### Task 1: CMS — collection `SubscriptionPlans`

**Files:**
- Create: `cms/src/collections/SubscriptionPlans.ts`
- Modify: `cms/src/payload.config.ts`
- Test: verifica manuale via Payload local dev (nessun file test)

**Interfaces:**
- Produces: collection Payload `subscription-plans` con campi `key` (`tattoo`|`pmu`, unique), `product` (relationship → `products`), `active` (checkbox). Letta in seguito dal Task 12 via `GET /api/subscription-plans?where[key][equals]=...`.

- [ ] **Step 1: Crea la collection**

```typescript
// cms/src/collections/SubscriptionPlans.ts
import type { CollectionConfig, PayloadRequest } from 'payload'

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

export const SubscriptionPlans: CollectionConfig = {
  slug: 'subscription-plans',
  admin: {
    useAsTitle: 'key',
    description: 'Collega ogni piano di abbonamento (tattoo/pmu) al prodotto del catalogo che ne fornisce foto e descrizione.',
    defaultColumns: ['key', 'product', 'active', 'updatedAt'],
    group: 'Abbonamenti',
  },
  access: {
    read: ({ req }) => !!req.user || hasStorefrontSecret(req),
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'key',
      type: 'select',
      required: true,
      unique: true,
      label: 'Piano',
      options: [
        { label: 'Tattoo XXL', value: 'tattoo' },
        { label: 'PMU 3 Visi', value: 'pmu' },
      ],
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      label: 'Prodotto (foto/descrizione)',
      admin: { description: 'Il prodotto del catalogo mostrato nella pagina di abbonamento.' },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Attivo',
    },
  ],
  timestamps: true,
}
```

- [ ] **Step 2: Registra la collection in payload.config.ts**

```typescript
// cms/src/payload.config.ts — aggiungi vicino agli altri import
import { SubscriptionPlans } from './collections/SubscriptionPlans'
```

Nell'array `collections: [...]`, aggiungi `SubscriptionPlans,` (posizione libera, es. dopo `OfferConfig`).

- [ ] **Step 3: Rigenera i tipi e verifica**

Run: `cd cms && npm run generate:types && npx tsc --noEmit`
Expected: nessun errore, `payload-types.ts` include `SubscriptionPlan`.

- [ ] **Step 4: Verifica manuale**

Run: `cd cms && npm run dev`, poi in un altro terminale:
```bash
curl -s http://localhost:3001/api/subscription-plans | head -c 300
```
Expected: risposta JSON `{"docs":[],"totalDocs":0,...}` (collection vuota ma raggiungibile, nessun 404/500).

- [ ] **Step 5: Commit**

```bash
git add cms/src/collections/SubscriptionPlans.ts cms/src/payload.config.ts cms/src/payload-types.ts
git commit -m "feat(cms): aggiungi collection SubscriptionPlans"
```

---

### Task 2: CMS — collection `Subscriptions`

**Files:**
- Create: `cms/src/collections/Subscriptions.ts`
- Modify: `cms/src/payload.config.ts`

**Interfaces:**
- Produces: collection Payload `subscriptions` con campi `customerEmail`, `plan` (`tattoo`|`pmu`), `zone` (`IT`|`EU`), `stripeSubscriptionId` (unique), `stripeScheduleId`, `status` (`active`|`canceling`|`canceled`), `cyclesCompleted` (number), `startedAt`, `canceledAt`. Usata dal Task 7 (webhook), Task 8 (cancel API), Task 9 (account page).

- [ ] **Step 1: Crea la collection**

```typescript
// cms/src/collections/Subscriptions.ts
import type { CollectionConfig, PayloadRequest } from 'payload'

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: {
    useAsTitle: 'stripeSubscriptionId',
    defaultColumns: ['customerEmail', 'plan', 'zone', 'status', 'cyclesCompleted', 'startedAt'],
    group: 'Abbonamenti',
  },
  access: {
    read: ({ req }) => !!req.user || hasStorefrontSecret(req),
    create: ({ req }) => !!req.user || hasStorefrontSecret(req),
    update: ({ req }) => !!req.user || hasStorefrontSecret(req),
    delete: ({ req }) => !!req.user,
  },
  fields: [
    { name: 'customerEmail', type: 'email', required: true, label: 'Email cliente' },
    {
      name: 'plan',
      type: 'select',
      required: true,
      label: 'Piano',
      options: [
        { label: 'Tattoo XXL', value: 'tattoo' },
        { label: 'PMU 3 Visi', value: 'pmu' },
      ],
    },
    {
      name: 'zone',
      type: 'select',
      required: true,
      label: 'Zona',
      options: [
        { label: 'Italia', value: 'IT' },
        { label: 'Europa', value: 'EU' },
      ],
    },
    { name: 'stripeSubscriptionId', type: 'text', required: true, unique: true, label: 'Stripe Subscription ID' },
    { name: 'stripeScheduleId', type: 'text', label: 'Stripe Schedule ID' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      label: 'Stato',
      options: [
        { label: 'Attivo', value: 'active' },
        { label: 'In cancellazione (fine periodo)', value: 'canceling' },
        { label: 'Cancellato', value: 'canceled' },
      ],
    },
    { name: 'cyclesCompleted', type: 'number', defaultValue: 0, label: 'Cicli completati', admin: { readOnly: true } },
    { name: 'startedAt', type: 'date', label: 'Iniziato il' },
    { name: 'canceledAt', type: 'date', label: 'Cancellato il' },
  ],
  timestamps: true,
}
```

- [ ] **Step 2: Registra in payload.config.ts**

```typescript
import { Subscriptions } from './collections/Subscriptions'
```
Aggiungi `Subscriptions,` all'array `collections`.

- [ ] **Step 3: Rigenera i tipi e verifica**

Run: `cd cms && npm run generate:types && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Verifica manuale**

Run: `curl -s http://localhost:3001/api/subscriptions | head -c 300` (con `cms` dev server attivo)
Expected: `{"docs":[],"totalDocs":0,...}`

- [ ] **Step 5: Commit**

```bash
git add cms/src/collections/Subscriptions.ts cms/src/payload.config.ts cms/src/payload-types.ts
git commit -m "feat(cms): aggiungi collection Subscriptions"
```

---

### Task 3: CMS — estendi `Orders` per supportare i rinnovi abbonamento

**Files:**
- Modify: `cms/src/collections/Orders.ts`

**Interfaces:**
- Produces: nuova opzione `subscription` sul campo select esistente `source` (già presente, label "Origine", dentro la collapsible "Dati tecnici" — non un nuovo campo). Nessun cambio a `lineItems`: è un campo `type: 'json'` schemaless (verificato: `cms/src/collections/Orders.ts:587-592`, nessun sotto-campo tipizzato), quindi accetta già chiavi arbitrarie come `isGift` senza bisogno di modifiche allo schema. Usato dal Task 7 quando crea l'Order di rinnovo: imposta `source: 'subscription'` e include `isGift: true` direttamente nell'oggetto JSON della riga omaggio, senza toccare questo file.

> **Nota di correzione (post pre-flight):** la versione originale di questo task ipotizzava `lineItems` come campo `array` tipizzato e proponeva un nuovo campo `origin` separato. Verificato che `lineItems` è `json` (nessuna migrazione necessaria, nessun rischio sui dati esistenti) e che esiste già un campo `source`/"Origine" con gli stessi scopi — aggiungere un secondo campo con la stessa label avrebbe creato confusione nell'admin. Questa versione corretta sostituisce quella originale.

- [ ] **Step 1: Conferma la struttura esistente**

Run: `grep -n "name: 'lineItems'\|name: 'source'" cms/src/collections/Orders.ts`
Expected: `lineItems` con `type: 'json'` (circa riga 588); `source` con `type: 'select'`, `label: 'Origine'`, dentro la collapsible "Dati tecnici" (circa riga 741), con opzioni `storefront`/`woocommerce`/`manual`/`reseller`.

- [ ] **Step 2: Aggiungi l'opzione `subscription` alle options di `source`**

Nel blocco esistente del campo `source`, aggiungi una riga alle sue `options`:

```typescript
{
  name: 'source',
  type: 'select',
  defaultValue: 'storefront',
  label: 'Origine',
  options: [
    { label: 'Storefront', value: 'storefront' },
    { label: 'WooCommerce', value: 'woocommerce' },
    { label: 'Manuale', value: 'manual' },
    { label: 'Rivenditore', value: 'reseller' },
    { label: 'Abbonamento', value: 'subscription' },
  ],
},
```

Nessun'altra modifica al file: non toccare `lineItems`, non aggiungere nuovi campi.

- [ ] **Step 3: Rigenera i tipi e verifica**

Run: `cd cms && npm run generate:types && npx tsc --noEmit`
Expected: nessun errore. `payload-types.ts` mostra `subscription` nell'union di tipo del campo `source` sull'interfaccia `Order`.

- [ ] **Step 4: Commit**

```bash
git add cms/src/collections/Orders.ts cms/src/payload-types.ts
git commit -m "feat(cms): aggiungi opzione subscription al campo source di Orders"
```

---

### Task 4: Storefront — tabella prezzi/benefici (`lib/subscription-plans.ts`)

**Files:**
- Modify: `storefront/src/lib/shipping.ts`
- Create: `storefront/src/lib/subscription-plans.ts`

**Interfaces:**
- Consumes: nessuna (modulo puro).
- Produces: `PlanKey` (`'tattoo'|'pmu'`), `Zone` (`'IT'|'EU'`), `SUBSCRIPTION_LADDER`, `getBenefitForCycle(plan, zone, cycle)`, `getNextTierCyclesRemaining(cyclesCompleted)`, `ZONE_COUNTRIES`. Usati da Task 5 (Stripe schedule), Task 6 (checkout), Task 7 (webhook), Task 9 (account UI), Task 10 (roadmap), Task 12 (landing).

- [ ] **Step 1: Esporta `EU_COUNTRIES` da shipping.ts**

In `storefront/src/lib/shipping.ts`, cambia:
```typescript
const EU_COUNTRIES = new Set([
```
in:
```typescript
export const EU_COUNTRIES = new Set([
```
(nessun altro cambiamento nel file)

- [ ] **Step 2: Scrivi `subscription-plans.ts`**

```typescript
// storefront/src/lib/subscription-plans.ts
import { EU_COUNTRIES } from './shipping'

export type PlanKey = 'tattoo' | 'pmu'
export type Zone = 'IT' | 'EU'

export interface PlanPhase {
  /** Numero di rinnovi in cui questa fase è attiva (l'ultima fase resta attiva indefinitamente dopo l'ultima iterazione). */
  iterations: number
  productPrice: number
  shippingPrice: number
  /** Se questo ciclo include il foglio/viso omaggio in fulfillment (non incide sul prezzo Stripe). */
  giftItem: boolean
}

export interface PlanConfig {
  giftLabel: string
  phases: [PlanPhase, PlanPhase, PlanPhase]
}

export const SUBSCRIPTION_LADDER: Record<PlanKey, Record<Zone, PlanConfig>> = {
  tattoo: {
    IT: {
      giftLabel: 'Foglio omaggio',
      phases: [
        { iterations: 1, productPrice: 45, shippingPrice: 7.65, giftItem: false },
        { iterations: 4, productPrice: 45, shippingPrice: 0, giftItem: false },
        { iterations: 1, productPrice: 40.5, shippingPrice: 0, giftItem: false },
      ],
    },
    EU: {
      giftLabel: 'Foglio omaggio',
      phases: [
        { iterations: 1, productPrice: 45, shippingPrice: 14.99, giftItem: false },
        { iterations: 4, productPrice: 45, shippingPrice: 14.99, giftItem: true },
        { iterations: 1, productPrice: 40.5, shippingPrice: 14.99, giftItem: true },
      ],
    },
  },
  pmu: {
    IT: {
      giftLabel: '4° viso omaggio',
      phases: [
        { iterations: 1, productPrice: 67.5, shippingPrice: 0, giftItem: false },
        { iterations: 4, productPrice: 60.75, shippingPrice: 0, giftItem: false },
        { iterations: 1, productPrice: 60.75, shippingPrice: 0, giftItem: true },
      ],
    },
    EU: {
      giftLabel: '4° viso omaggio',
      phases: [
        { iterations: 1, productPrice: 67.5, shippingPrice: 14.99, giftItem: false },
        { iterations: 4, productPrice: 67.5, shippingPrice: 14.99, giftItem: true },
        { iterations: 1, productPrice: 60.75, shippingPrice: 14.99, giftItem: true },
      ],
    },
  },
}

/** Ciclo 1 → fase 0. Cicli 2-5 → fase 1. Ciclo 6+ → fase 2. */
export function getPhaseIndexForCycle(cycle: number): 0 | 1 | 2 {
  if (cycle <= 1) return 0
  if (cycle <= 5) return 1
  return 2
}

export function getBenefitForCycle(plan: PlanKey, zone: Zone, cycle: number) {
  const config = SUBSCRIPTION_LADDER[plan][zone]
  const phase = config.phases[getPhaseIndexForCycle(cycle)]
  return {
    productPrice: phase.productPrice,
    shippingPrice: phase.shippingPrice,
    giftItem: phase.giftItem,
    total: Math.round((phase.productPrice + phase.shippingPrice) * 100) / 100,
  }
}

/** Cicli mancanti al raggiungimento del ciclo 6 (tier finale). 0 se già raggiunto. */
export function getNextTierCyclesRemaining(cyclesCompleted: number): number {
  return Math.max(0, 6 - cyclesCompleted)
}

export const ZONE_COUNTRIES: Record<Zone, string[]> = {
  IT: ['IT'],
  EU: [...EU_COUNTRIES],
}

export const PLAN_NAMES: Record<PlanKey, string> = {
  tattoo: 'Abbonamento Tattoo XXL',
  pmu: 'Abbonamento PMU 3 Visi',
}
```

- [ ] **Step 3: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Verifica manuale dei numeri**

Run:
```bash
cd storefront && npx tsx -e "
import { getBenefitForCycle, getNextTierCyclesRemaining } from './src/lib/subscription-plans'
console.log(getBenefitForCycle('tattoo','IT',1))
console.log(getBenefitForCycle('tattoo','IT',2))
console.log(getBenefitForCycle('tattoo','IT',6))
console.log(getBenefitForCycle('tattoo','EU',2))
console.log(getBenefitForCycle('pmu','IT',6))
console.log(getNextTierCyclesRemaining(1), getNextTierCyclesRemaining(6))
"
```
Expected output (valori arrotondati a 2 decimali):
```
{ productPrice: 45, shippingPrice: 7.65, giftItem: false, total: 52.65 }
{ productPrice: 45, shippingPrice: 0, giftItem: false, total: 45 }
{ productPrice: 40.5, shippingPrice: 0, giftItem: false, total: 40.5 }
{ productPrice: 45, shippingPrice: 14.99, giftItem: true, total: 59.99 }
{ productPrice: 60.75, shippingPrice: 0, giftItem: true, total: 60.75 }
5 0
```
Se `npx tsx` non è disponibile, installa al volo con `npx --yes tsx@latest -e "..."`.

- [ ] **Step 5: Commit**

```bash
git add storefront/src/lib/shipping.ts storefront/src/lib/subscription-plans.ts
git commit -m "feat(storefront): aggiungi tabella prezzi/benefici abbonamento pelle"
```

---

### Task 5: Storefront — costruttore fasi Stripe (`lib/stripe-subscription-schedule.ts`)

**Files:**
- Create: `storefront/src/lib/stripe-subscription-schedule.ts`

**Interfaces:**
- Consumes: `SUBSCRIPTION_LADDER`, `PlanKey`, `Zone`, `PLAN_NAMES` da `subscription-plans.ts` (Task 4).
- Produces: `buildSchedulePhases(plan, zone): Stripe.SubscriptionScheduleCreateParams.Phase[]`, `attachScheduleToSubscription(stripe, subscriptionId, plan, zone): Promise<Stripe.SubscriptionSchedule>`. Usati da Task 7 (webhook).

- [ ] **Step 1: Scrivi il file**

```typescript
// storefront/src/lib/stripe-subscription-schedule.ts
import Stripe from 'stripe'
import { SUBSCRIPTION_LADDER, PLAN_NAMES, type PlanKey, type Zone } from './subscription-plans'

export function buildSchedulePhases(
  plan: PlanKey,
  zone: Zone,
): Stripe.SubscriptionScheduleCreateParams.Phase[] {
  const config = SUBSCRIPTION_LADDER[plan][zone]
  return config.phases.map((phase) => ({
    iterations: phase.iterations,
    items: [
      {
        price_data: {
          currency: 'eur',
          recurring: { interval: 'month' },
          unit_amount: Math.round((phase.productPrice + phase.shippingPrice) * 100),
          product_data: { name: `${PLAN_NAMES[plan]} — ${zone}` },
        },
        quantity: 1,
      },
    ],
  }))
}

/**
 * Converte la Subscription appena creata da Checkout in uno Subscription Schedule
 * a 3 fasi. La prima fase deve riusare lo start_date che Stripe assegna
 * automaticamente alla fase corrente (già in corso di fatturazione) — non può
 * essere una nostra scelta arbitraria, altrimenti Stripe rifiuta l'update.
 */
export async function attachScheduleToSubscription(
  stripe: Stripe,
  subscriptionId: string,
  plan: PlanKey,
  zone: Zone,
): Promise<Stripe.SubscriptionSchedule> {
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId })
  const builtPhases = buildSchedulePhases(plan, zone)
  const currentPhaseStart = schedule.phases[0].start_date

  return stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      { ...builtPhases[0], start_date: currentPhaseStart },
      builtPhases[1],
      builtPhases[2],
    ],
  })
}
```

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore (conferma che i tipi `Stripe.SubscriptionScheduleCreateParams.Phase` accettano `price_data` così strutturato — se il compilatore segnala un campo mancante, allinea ai tipi esposti da `stripe` v22 in `node_modules/stripe/types/SubscriptionSchedules.d.ts`).

- [ ] **Step 3: Commit**

```bash
git add storefront/src/lib/stripe-subscription-schedule.ts
git commit -m "feat(storefront): costruttore fasi Stripe Subscription Schedule per abbonamento"
```

---

### Task 6: Storefront — endpoint checkout abbonamento

**Files:**
- Create: `storefront/src/app/api/subscribe/checkout/route.ts`

**Interfaces:**
- Consumes: `SUBSCRIPTION_LADDER`, `ZONE_COUNTRIES`, `PLAN_NAMES`, `PlanKey`, `Zone` da `subscription-plans.ts`.
- Produces: `POST /api/subscribe/checkout` — body `{ plan: PlanKey, zone: Zone, email: string, locale: string }`, risposta `{ checkoutUrl: string }`. Consumato da Task 12 (`SubscribeCTA.tsx`).

- [ ] **Step 1: Scrivi la route**

```typescript
// storefront/src/app/api/subscribe/checkout/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { SUBSCRIPTION_LADDER, ZONE_COUNTRIES, PLAN_NAMES, type PlanKey, type Zone } from '@/lib/subscription-plans'

export const dynamic = 'force-dynamic'

const STOREFRONT_URL = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'

interface Body {
  plan: PlanKey
  zone: Zone
  email: string
  locale: string
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  const { plan, zone, email, locale } = (await req.json()) as Body

  if (!SUBSCRIPTION_LADDER[plan]?.[zone] || !email) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const firstPhase = SUBSCRIPTION_LADDER[plan][zone].phases[0]
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    billing_address_collection: 'auto',
    shipping_address_collection: {
      allowed_countries: ZONE_COUNTRIES[zone] as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    },
    line_items: [
      {
        price_data: {
          currency: 'eur',
          recurring: { interval: 'month' },
          unit_amount: Math.round((firstPhase.productPrice + firstPhase.shippingPrice) * 100),
          product_data: { name: `${PLAN_NAMES[plan]} — ${zone}` },
        },
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: { plan, zone, customerEmail: email, locale },
    },
    success_url: `${STOREFRONT_URL}/${locale}/abbonamento/${plan}?subscribed=1`,
    cancel_url: `${STOREFRONT_URL}/${locale}/abbonamento/${plan}`,
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
```

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Verifica manuale con curl (server dev attivo, `npm run dev` in `storefront/`)**

```bash
curl -s -X POST http://localhost:3000/api/subscribe/checkout \
  -H "Content-Type: application/json" \
  -d '{"plan":"tattoo","zone":"IT","email":"test@example.com","locale":"it"}'
```
Expected: JSON `{"checkoutUrl":"https://checkout.stripe.com/..."}`. Se manca `STRIPE_SECRET_KEY` in locale, expected: `{"error":"Stripe non configurato"}` con status 503 — accettabile per questo step se le chiavi Stripe non sono disponibili in ambiente locale (verrà verificato end-to-end in staging).

- [ ] **Step 4: Commit**

```bash
git add storefront/src/app/api/subscribe/checkout/route.ts
git commit -m "feat(storefront): endpoint checkout abbonamento (Stripe subscription mode)"
```

---

### Task 7: Storefront — webhook: attach schedule, rinnovi, cancellazione

**Files:**
- Modify: `storefront/src/app/api/webhook/stripe/route.ts`

**Interfaces:**
- Consumes: `attachScheduleToSubscription` (Task 5), `getBenefitForCycle` (Task 4), `PlanKey`/`Zone` (Task 4).
- Produces: side effects su CMS (`subscriptions`, `orders`) raggiungibili dal Task 9 (account page) via GET `/api/subscriptions?where[customerEmail][equals]=...`.

- [ ] **Step 1: Aggiungi gli import necessari in cima al file**

```typescript
import { attachScheduleToSubscription } from '@/lib/stripe-subscription-schedule'
import { getBenefitForCycle, type PlanKey, type Zone } from '@/lib/subscription-plans'
```

- [ ] **Step 2: Aggiungi gli helper CMS per le subscription, sopra `export async function POST`**

```typescript
const CMS_URL = () => process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
const cmsHeaders = () => ({
  'Content-Type': 'application/json',
  'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
})

interface SubscriptionDoc {
  id: string
  customerEmail: string
  plan: PlanKey
  zone: Zone
  stripeSubscriptionId: string
  stripeScheduleId?: string
  status: 'active' | 'canceling' | 'canceled'
  cyclesCompleted: number
}

async function findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionDoc | null> {
  const res = await fetch(
    `${CMS_URL()}/api/subscriptions?where[stripeSubscriptionId][equals]=${encodeURIComponent(stripeSubscriptionId)}&limit=1`,
    { headers: cmsHeaders() },
  )
  if (!res.ok) throw new Error(`CMS find subscription failed ${res.status}`)
  const data = await res.json()
  return data.docs?.[0] ?? null
}

async function createSubscriptionRecord(params: {
  customerEmail: string
  plan: PlanKey
  zone: Zone
  stripeSubscriptionId: string
  stripeScheduleId: string
}): Promise<SubscriptionDoc> {
  const res = await fetch(`${CMS_URL()}/api/subscriptions`, {
    method: 'POST',
    headers: cmsHeaders(),
    body: JSON.stringify({
      ...params,
      status: 'active',
      cyclesCompleted: 0,
      startedAt: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error(`CMS create subscription failed ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.doc as SubscriptionDoc
}

async function updateSubscriptionRecord(id: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${CMS_URL()}/api/subscriptions/${id}`, {
    method: 'PATCH',
    headers: cmsHeaders(),
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`CMS update subscription failed ${res.status}: ${await res.text()}`)
}

const SUB_PLAN_NAMES: Record<PlanKey, string> = {
  tattoo: 'Abbonamento Tattoo XXL',
  pmu: 'Abbonamento PMU 3 Visi',
}

async function createRenewalOrder(params: {
  subscriptionId: string
  cycle: number
  plan: PlanKey
  zone: Zone
  customerEmail: string
  shippingAddress: { name: string; address1: string; address2: string; city: string; postalCode: string; country: string }
}): Promise<void> {
  const { subscriptionId, cycle, plan, zone, customerEmail, shippingAddress } = params
  const orderRef = `FOOLISH-SUB-${subscriptionId}-${cycle}`

  const existing = await fetch(
    `${CMS_URL()}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderRef)}&limit=1`,
    { headers: cmsHeaders() },
  )
  if (existing.ok) {
    const existingData = await existing.json()
    if (existingData.docs?.length > 0) return // idempotente: Stripe può reinviare il webhook
  }

  const benefit = getBenefitForCycle(plan, zone, cycle)
  const lineItems = [
    { sku: `SUB-${plan.toUpperCase()}`, name: SUB_PLAN_NAMES[plan], variantLabel: `Ciclo ${cycle}`, quantity: 1, unitPrice: benefit.productPrice },
    ...(benefit.giftItem
      ? [{ sku: `SUB-${plan.toUpperCase()}-GIFT`, name: 'Omaggio abbonamento', variantLabel: '', quantity: 1, unitPrice: 0, isGift: true }]
      : []),
  ]

  const res = await fetch(`${CMS_URL()}/api/orders`, {
    method: 'POST',
    headers: cmsHeaders(),
    body: JSON.stringify({
      orderNumber: orderRef,
      source: 'subscription',
      customerEmail,
      customerName: shippingAddress.name,
      lineItems,
      total: benefit.total,
      shippingCost: benefit.shippingPrice,
      shippingAddress,
      pipelineState: 'received',
    }),
  })
  if (!res.ok) throw new Error(`CMS create renewal order failed ${res.status}: ${await res.text()}`)
}
```

- [ ] **Step 3: Aggiungi il branch subscription dentro `checkout.session.completed`, subito dopo la riga `const session = event.data.object`**

Trova questo blocco esistente (circa riga 152-156):
```typescript
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }
```

Sostituiscilo con:
```typescript
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    if (session.mode === 'subscription') {
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      const meta = session.metadata ?? {}
      const plan = meta.plan as PlanKey | undefined
      const zone = meta.zone as Zone | undefined
      const customerEmail = (session.customer_email ?? session.customer_details?.email ?? meta.customerEmail ?? '').toLowerCase()

      if (subscriptionId && plan && zone && customerEmail) {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          const existing = await findSubscriptionByStripeId(subscriptionId)
          if (!existing) {
            const schedule = await attachScheduleToSubscription(stripe, subscriptionId, plan, zone)
            await createSubscriptionRecord({
              customerEmail,
              plan,
              zone,
              stripeSubscriptionId: subscriptionId,
              stripeScheduleId: schedule.id,
            })
            console.log(`[webhook] Subscription schedule attached ${subscriptionId} (${plan}/${zone})`)
          }
        } catch (err) {
          console.error('[webhook] Subscription schedule attach failed:', err)
        }
      }
      return NextResponse.json({ received: true })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }
```

- [ ] **Step 4: Aggiungi i due nuovi case dopo il blocco `if (event.type === 'checkout.session.completed') { ... }` esistente, prima del `return NextResponse.json({ received: true })` finale**

```typescript
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object
    const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id

    if (subscriptionId) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
        let record = await findSubscriptionByStripeId(subscriptionId)

        if (!record) {
          // L'invoice del primo ciclo può arrivare prima del checkout.session.completed:
          // ricostruiamo il record dalla subscription Stripe (ha i metadata impostati da subscription_data.metadata).
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
          const plan = stripeSub.metadata.plan as PlanKey
          const zone = stripeSub.metadata.zone as Zone
          const customerEmail = (stripeSub.metadata.customerEmail || '').toLowerCase()
          if (!plan || !zone || !customerEmail) throw new Error(`Subscription ${subscriptionId} senza metadata plan/zone/email`)
          record = await createSubscriptionRecord({
            customerEmail,
            plan,
            zone,
            stripeSubscriptionId: subscriptionId,
            stripeScheduleId: typeof stripeSub.schedule === 'string' ? stripeSub.schedule : '',
          })
        }

        const newCycle = record.cyclesCompleted + 1
        await updateSubscriptionRecord(record.id, { cyclesCompleted: newCycle })

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shippingDetails = (invoice as any).customer_shipping ?? null
        const shippingAddress = {
          name: shippingDetails?.name ?? '',
          address1: shippingDetails?.address?.line1 ?? '',
          address2: shippingDetails?.address?.line2 ?? '',
          city: shippingDetails?.address?.city ?? '',
          postalCode: shippingDetails?.address?.postal_code ?? '',
          country: shippingDetails?.address?.country ?? record.zone,
        }

        await createRenewalOrder({
          subscriptionId,
          cycle: newCycle,
          plan: record.plan,
          zone: record.zone,
          customerEmail: record.customerEmail,
          shippingAddress,
        })
        console.log(`[webhook] Renewal order created for ${subscriptionId}, cycle ${newCycle}`)
      } catch (err) {
        console.error('[webhook] invoice.payment_succeeded handling failed:', err)
      }
    }
    return NextResponse.json({ received: true })
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    try {
      const record = await findSubscriptionByStripeId(subscription.id)
      if (record) {
        await updateSubscriptionRecord(record.id, { status: 'canceled', canceledAt: new Date().toISOString() })
        console.log(`[webhook] Subscription ${subscription.id} marked canceled`)
      }
    } catch (err) {
      console.error('[webhook] customer.subscription.deleted handling failed:', err)
    }
    return NextResponse.json({ received: true })
  }
```

- [ ] **Step 5: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore. Se `invoice.subscription` o `session.subscription` risultano con tipo diverso da quello atteso nei tipi Stripe v22, allinea leggendo `node_modules/stripe/types/Invoices.d.ts` e `Checkout/Sessions.d.ts`.

- [ ] **Step 6: Verifica manuale con Stripe CLI (richiede `stripe login` già fatto)**

```bash
stripe listen --forward-to localhost:3000/api/webhook/stripe &
stripe trigger checkout.session.completed --add checkout_session:mode=subscription
```
Expected nei log del dev server: nessun crash; dato che l'evento simulato non ha i nostri metadata reali (`plan`/`zone`), expected log `[webhook] Subscription schedule attach failed:` con errore descrittivo (comportamento corretto: il codice non deve andare in crash su un evento senza metadata validi). La verifica end-to-end reale richiede un test manuale in staging con una vera Checkout Session creata dal Task 6.

- [ ] **Step 7: Commit**

```bash
git add storefront/src/app/api/webhook/stripe/route.ts
git commit -m "feat(storefront): webhook gestisce attach schedule, rinnovi e cancellazione abbonamento"
```

---

### Task 8: Storefront — cancellazione abbonamento

**Files:**
- Create: `storefront/src/app/api/account/subscription/cancel/route.ts`

**Interfaces:**
- Consumes: `getSession()` da `@/lib/account-auth`.
- Produces: `POST /api/account/subscription/cancel` — body `{ subscriptionDocId: string }`, risposta `{ ok: true }`. Consumato da Task 9 (`CancelSubscriptionButton.tsx`).

- [ ] **Step 1: Scrivi la route**

```typescript
// storefront/src/app/api/account/subscription/cancel/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSession } from '@/lib/account-auth'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { subscriptionDocId } = (await req.json()) as { subscriptionDocId: string }
  if (!subscriptionDocId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const docRes = await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
  })
  if (!docRes.ok) return NextResponse.json({ error: 'Abbonamento non trovato' }, { status: 404 })
  const doc = await docRes.json()

  if (doc.customerEmail?.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  await stripe.subscriptions.update(doc.stripeSubscriptionId, { cancel_at_period_end: true })

  await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
    body: JSON.stringify({ status: 'canceling' }),
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add storefront/src/app/api/account/subscription/cancel/route.ts
git commit -m "feat(storefront): endpoint cancellazione abbonamento a fine periodo"
```

---

### Task 9: Storefront — pagina account "Il mio abbonamento"

**Files:**
- Create: `storefront/src/app/(customer-app)/account/(protected)/abbonamento/page.tsx`
- Create: `storefront/src/app/(customer-app)/account/(protected)/abbonamento/_components/CancelSubscriptionButton.tsx`
- Modify: `storefront/src/app/(customer-app)/account/(protected)/layout.tsx`

**Interfaces:**
- Consumes: `getSession()`, `getAccountLocale()`/`getT()`, `getNextTierCyclesRemaining`/`getBenefitForCycle` (Task 4), `POST /api/account/subscription/cancel` (Task 8).

- [ ] **Step 1: Aggiungi le chiavi di traduzione in `account-translations.ts`**

Run: `grep -n "nav_home\|nav_orders" storefront/src/lib/account-translations.ts` per individuare la struttura del dizionario, poi aggiungi per ciascuna lingua già presente le chiavi: `nav_subscription`, `subscription_title`, `subscription_cycle`, `subscription_current_price`, `subscription_next_tier` (con placeholder `{n}`), `subscription_maxed`, `subscription_cancel`, `subscription_canceling`, `subscription_none`. Segui esattamente lo stesso pattern chiave→stringa già usato per `nav_orders` nello stesso file, duplicato per ogni lingua supportata (`SUPPORTED_LOCALES`).

- [ ] **Step 2: Aggiungi la voce di navigazione**

In `storefront/src/app/(customer-app)/account/(protected)/layout.tsx`, nell'array della `nav` (righe 35-40 circa), aggiungi una voce tra `offerta` e `file`:
```typescript
{ href: '/account/abbonamento', label: t('nav_subscription'), icon: '📦' },
```

- [ ] **Step 3: Crea il bottone client di cancellazione**

```typescript
// storefront/src/app/(customer-app)/account/(protected)/abbonamento/_components/CancelSubscriptionButton.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CancelSubscriptionButton({ subscriptionDocId, label, confirmLabel }: {
  subscriptionDocId: string
  label: string
  confirmLabel: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleCancel() {
    if (!confirm(confirmLabel)) return
    setLoading(true)
    const res = await fetch('/api/account/subscription/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionDocId }),
    })
    setLoading(false)
    if (res.ok) router.refresh()
  }

  return (
    <button
      onClick={handleCancel}
      disabled={loading}
      style={{
        background: 'transparent', border: '1px solid #5a2a2a', color: '#c07a7a',
        borderRadius: '6px', padding: '8px 14px', fontSize: '11px', textTransform: 'uppercase',
        letterSpacing: '0.05em', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : label}
    </button>
  )
}
```

- [ ] **Step 4: Crea la pagina**

```typescript
// storefront/src/app/(customer-app)/account/(protected)/abbonamento/page.tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import { getBenefitForCycle, getNextTierCyclesRemaining, type PlanKey, type Zone } from '@/lib/subscription-plans'
import { CancelSubscriptionButton } from './_components/CancelSubscriptionButton'

const PLAN_LABELS: Record<PlanKey, string> = { tattoo: 'Tattoo XXL', pmu: 'PMU 3 Visi' }
const ZONE_LABELS: Record<Zone, string> = { IT: 'Italia', EU: 'Europa' }

interface SubscriptionDoc {
  id: string
  plan: PlanKey
  zone: Zone
  status: 'active' | 'canceling' | 'canceled'
  cyclesCompleted: number
}

export default async function AbbonamentoPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const locale = await getAccountLocale()
  const t = getT(locale)

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/subscriptions?where[customerEmail][equals]=${encodeURIComponent(session.email)}&where[status][not_equals]=canceled&sort=-createdAt&limit=10&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' },
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const subscriptions: SubscriptionDoc[] = data.docs ?? []

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
          {t('subscription_title')}
        </div>
      </div>

      {subscriptions.length === 0 && (
        <p style={{ fontSize: '12px', color: '#777' }}>{t('subscription_none')}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {subscriptions.map((sub) => {
          const currentCycle = Math.max(1, sub.cyclesCompleted)
          const benefit = getBenefitForCycle(sub.plan, sub.zone, currentCycle)
          const cyclesRemaining = getNextTierCyclesRemaining(sub.cyclesCompleted)

          return (
            <div key={sub.id} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
                {PLAN_LABELS[sub.plan]} · {ZONE_LABELS[sub.zone]}
              </div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                {t('subscription_cycle')} {currentCycle} · {t('subscription_current_price')} €{benefit.total.toFixed(2)}
              </div>
              <div style={{ fontSize: '11px', color: '#c9a96e', marginBottom: '10px' }}>
                {cyclesRemaining > 0
                  ? t('subscription_next_tier').replace('{n}', String(cyclesRemaining))
                  : t('subscription_maxed')}
              </div>
              {sub.status === 'canceling' ? (
                <span style={{ fontSize: '11px', color: '#c07a7a' }}>{t('subscription_canceling')}</span>
              ) : (
                <CancelSubscriptionButton
                  subscriptionDocId={sub.id}
                  label={t('subscription_cancel')}
                  confirmLabel={t('subscription_cancel')}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 6: Verifica manuale in browser**

Con `storefront` in dev e una sessione account attiva, apri `/account/abbonamento`. Expected: pagina renderizzata senza crash, messaggio "nessun abbonamento" visibile (nessun dato reale ancora presente in questa fase del piano).

- [ ] **Step 7: Commit**

```bash
git add storefront/src/app/\(customer-app\)/account/\(protected\)/abbonamento storefront/src/app/\(customer-app\)/account/\(protected\)/layout.tsx storefront/src/lib/account-translations.ts
git commit -m "feat(storefront): pagina account gestione abbonamento"
```

---

### Task 10: Storefront — componente `SubscriptionRoadmap`

**Files:**
- Create: `storefront/src/components/SubscriptionRoadmap.tsx`

**Interfaces:**
- Consumes: `SUBSCRIPTION_LADDER`, `PlanKey`, `Zone` (Task 4).
- Produces: `<SubscriptionRoadmap plan={PlanKey} labels={{...}} />` — client component con tab Italia/Europa, usato da Task 12.

- [ ] **Step 1: Scrivi il componente**

Riprende il design approvato nel companion visivo (roadmap orizzontale, tab IT/EU, palette brand: `#080808`, accent `#c8a97e`, Cormorant italic via classe `.font-display`/`.stat-number`, prezzi in `.text-mono`, già definite in `globals.css`).

```typescript
// storefront/src/components/SubscriptionRoadmap.tsx
'use client'
import { useState } from 'react'
import { SUBSCRIPTION_LADDER, type PlanKey, type Zone } from '@/lib/subscription-plans'

interface Props {
  plan: PlanKey
  labels: {
    tabIt: string
    tabEu: string
    cycle1: string
    cycle2: string
    cycle6: string
    shippingIncluded: string
    perMonth: string
  }
}

export function SubscriptionRoadmap({ plan, labels }: Props) {
  const [zone, setZone] = useState<Zone>('IT')
  const config = SUBSCRIPTION_LADDER[plan][zone]
  const stepLabels = [labels.cycle1, labels.cycle2, labels.cycle6]

  return (
    <div className="fb-wrap">
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['IT', 'EU'] as const).map((z) => (
          <button
            key={z}
            onClick={() => setZone(z)}
            style={{
              fontFamily: 'system-ui, sans-serif', fontSize: '11px', letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '7px 16px', borderRadius: '20px',
              border: `1px solid ${zone === z ? 'var(--accent)' : 'var(--border)'}`,
              color: zone === z ? 'var(--accent)' : 'var(--muted-fg)', background: 'transparent', cursor: 'pointer',
            }}
          >
            {z === 'IT' ? labels.tabIt : labels.tabEu}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '4px', padding: '24px' }}>
        <div style={{ display: 'flex' }}>
          {config.phases.map((phase, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', position: 'relative', paddingTop: '20px' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'var(--accent)' }} />
              <div style={{
                position: 'absolute', top: '-4px', left: '50%', transform: 'translateX(-50%)',
                width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent)',
              }} />
              <div className="stat-number" style={{ fontSize: '30px', color: 'var(--accent)' }}>
                {String(i === 0 ? 1 : i === 1 ? 2 : 6).padStart(2, '0')}
              </div>
              <div style={{ fontFamily: 'system-ui, sans-serif', color: 'var(--foreground)', fontSize: '12px', marginTop: '6px' }}>
                {stepLabels[i]}
              </div>
              <div className="text-mono" style={{ fontSize: '11px', color: 'var(--foreground)', marginTop: '4px' }}>
                €{(phase.productPrice + phase.shippingPrice).toFixed(2)} {labels.perMonth}
              </div>
              {phase.shippingPrice === 0 && (
                <div style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px' }}>{labels.shippingIncluded}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add storefront/src/components/SubscriptionRoadmap.tsx
git commit -m "feat(storefront): componente roadmap benefici abbonamento con tab IT/EU"
```

---

### Task 11: Storefront — hub `/[locale]/abbonamento`

**Files:**
- Create: `storefront/src/app/[locale]/abbonamento/page.tsx`
- Modify: `storefront/messages/{it,en,de,fr,es}.json`

**Interfaces:**
- Consumes: `getTranslations`/`getLocale` (next-intl).

- [ ] **Step 1: Aggiungi il namespace `subscription` ai file messages**

In ciascuno dei 5 file (`storefront/messages/it.json`, `en.json`, `de.json`, `fr.json`, `es.json`), aggiungi una chiave top-level `"subscription"` (stesso livello di `"sections"`, `"home"`, ecc.). Per `it.json`:

```json
"subscription": {
  "hub": {
    "meta": "Abbonamento mensile",
    "title": "Ricevi la tua pelle ogni mese",
    "subtitle": "Un abbonamento, due referenze: Tattoo XXL e PMU 3 Visi. Meno spedizione, più pratica.",
    "cardTattooTitle": "Tattoo XXL",
    "cardTattooDesc": "Il foglio pratica di riferimento, ogni mese nella tua cassetta.",
    "cardPmuTitle": "PMU 3 Visi",
    "cardPmuDesc": "Il set pratica permanent makeup, sempre pronto.",
    "cta": "Scopri l'abbonamento"
  },
  "product": {
    "tabIt": "Italia",
    "tabEu": "Europa",
    "cycle1": "Si parte",
    "cycle2": "Spedizione azzerata",
    "cycle6": "-10% per sempre",
    "shippingIncluded": "spedizione inclusa",
    "perMonth": "/mese",
    "zonePickerLabel": "Dove spediamo?",
    "subscribeCta": "Abbonati ora",
    "loading": "Un attimo..."
  }
}
```

Per `en.json`, `de.json`, `fr.json`, `es.json` usa la stessa struttura di chiavi con testo tradotto in inglese/tedesco/francese/spagnolo (stesso registro sobrio-editoriale usato nelle altre sezioni di quei file, es. `sections.tattoo.description`).

- [ ] **Step 2: Crea la pagina hub**

```typescript
// storefront/src/app/[locale]/abbonamento/page.tsx
export const dynamic = 'force-dynamic'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations('subscription.hub')
  const langs = Object.fromEntries(LOCALES.map((l) => [l, `${BASE}/${l}/abbonamento`]))
  return {
    title: t('meta'),
    alternates: { canonical: `${BASE}/${locale}/abbonamento`, languages: { ...langs, 'x-default': `${BASE}/it/abbonamento` } },
  }
}

export default async function AbbonamentoHubPage() {
  const t = await getTranslations('subscription.hub')
  const locale = await getLocale()

  const cards = [
    { plan: 'tattoo', title: t('cardTattooTitle'), desc: t('cardTattooDesc') },
    { plan: 'pmu', title: t('cardPmuTitle'), desc: t('cardPmuDesc') },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--accent)' }}>{t('meta')}</p>
      <h1 className="font-display text-4xl md:text-5xl mb-4">{t('title')}</h1>
      <p className="max-w-xl mb-12" style={{ color: 'var(--muted-fg)' }}>{t('subtitle')}</p>

      <div className="grid md:grid-cols-2 gap-6">
        {cards.map((c) => (
          <Link
            key={c.plan}
            href={`/${locale}/abbonamento/${c.plan}`}
            className="block p-8 rounded"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <h2 className="font-artisan text-2xl mb-3">{c.title}</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>{c.desc}</p>
            <span className="ghost-cta text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
              {t('cta')} →
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Verifica manuale in browser**

Apri `/it/abbonamento`. Expected: due card (Tattoo XXL, PMU 3 Visi) visibili, link funzionanti verso `/it/abbonamento/tattoo` e `/it/abbonamento/pmu` (le pagine di destinazione arrivano nel Task 12 — per ora daranno 404, atteso).

- [ ] **Step 5: Commit**

```bash
git add storefront/src/app/\[locale\]/abbonamento/page.tsx storefront/messages
git commit -m "feat(storefront): hub abbonamento localizzato"
```

---

### Task 12: Storefront — pagina prodotto abbonamento `/[locale]/abbonamento/[plan]`

**Files:**
- Create: `storefront/src/app/[locale]/abbonamento/[plan]/page.tsx`
- Create: `storefront/src/app/[locale]/abbonamento/[plan]/_components/SubscribeCTA.tsx`
- Modify: `storefront/src/lib/cms.ts`

**Interfaces:**
- Consumes: `SubscriptionRoadmap` (Task 10), `POST /api/subscribe/checkout` (Task 6), `PlanKey` (Task 4).
- Produces: `getSubscriptionPlanConfig(key, locale)` aggiunta a `lib/cms.ts`, usata da questa pagina.

- [ ] **Step 1: Aggiungi il fetch della config piano in `lib/cms.ts`**

Alla fine del file, aggiungi:

```typescript
export interface SubscriptionPlanConfig {
  key: 'tattoo' | 'pmu'
  product: Product
  active: boolean
}

export async function getSubscriptionPlanConfig(key: 'tattoo' | 'pmu', locale = 'it'): Promise<SubscriptionPlanConfig | null> {
  const data = await fetchAPI<{ docs: SubscriptionPlanConfig[] }>(
    '/subscription-plans',
    { 'where[key][equals]': key, 'where[active][equals]': 'true', depth: '2', limit: '1' },
    locale,
  )
  return data.docs[0] ?? null
}
```

- [ ] **Step 2: Crea il client component per zona + CTA**

```typescript
// storefront/src/app/[locale]/abbonamento/[plan]/_components/SubscribeCTA.tsx
'use client'
import { useState } from 'react'
import type { PlanKey, Zone } from '@/lib/subscription-plans'

export function SubscribeCTA({ plan, locale, ctaLabel, loadingLabel, zonePickerLabel, tabIt, tabEu }: {
  plan: PlanKey
  locale: string
  ctaLabel: string
  loadingLabel: string
  zonePickerLabel: string
  tabIt: string
  tabEu: string
}) {
  const [zone, setZone] = useState<Zone>('IT')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubscribe() {
    if (!email) return
    setLoading(true)
    const res = await fetch('/api/subscribe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, zone, email, locale }),
    })
    const data = await res.json()
    setLoading(false)
    if (data.checkoutUrl) window.location.href = data.checkoutUrl
  }

  return (
    <div style={{ marginTop: '24px' }}>
      <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--muted-fg)' }}>{zonePickerLabel}</p>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        {(['IT', 'EU'] as const).map((z) => (
          <button
            key={z}
            onClick={() => setZone(z)}
            style={{
              fontSize: '11px', textTransform: 'uppercase', padding: '7px 16px', borderRadius: '20px',
              border: `1px solid ${zone === z ? 'var(--accent)' : 'var(--border)'}`,
              color: zone === z ? 'var(--accent)' : 'var(--muted-fg)', background: 'transparent', cursor: 'pointer',
            }}
          >
            {z === 'IT' ? tabIt : tabEu}
          </button>
        ))}
      </div>
      <input
        type="email"
        placeholder="email@esempio.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{
          width: '100%', maxWidth: '320px', padding: '10px 14px', marginBottom: '12px',
          background: 'var(--muted)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--foreground)',
        }}
      />
      <button
        onClick={handleSubscribe}
        disabled={loading || !email}
        className="ghost-cta"
        style={{
          display: 'block', padding: '12px 28px', border: '1px solid var(--accent)', color: 'var(--accent)',
          background: 'transparent', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.08em',
          cursor: loading ? 'default' : 'pointer', opacity: !email ? 0.5 : 1,
        }}
      >
        {loading ? loadingLabel : ctaLabel}
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Crea la pagina prodotto**

```typescript
// storefront/src/app/[locale]/abbonamento/[plan]/page.tsx
export const dynamic = 'force-dynamic'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations, getLocale } from 'next-intl/server'
import { getSubscriptionPlanConfig } from '@/lib/cms'
import { SubscriptionRoadmap } from '@/components/SubscriptionRoadmap'
import { SubscribeCTA } from './_components/SubscribeCTA'
import type { PlanKey } from '@/lib/subscription-plans'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
const VALID_PLANS = ['tattoo', 'pmu'] as const

interface Props {
  params: Promise<{ plan: string; locale: string }>
}

function isValidPlan(plan: string): plan is PlanKey {
  return (VALID_PLANS as readonly string[]).includes(plan)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { plan, locale } = await params
  if (!isValidPlan(plan)) return {}
  const config = await getSubscriptionPlanConfig(plan, locale)
  const langs = Object.fromEntries(LOCALES.map((l) => [l, `${BASE}/${l}/abbonamento/${plan}`]))
  return {
    title: config?.product.name ?? plan,
    description: config?.product.shortDescription,
    alternates: { canonical: `${BASE}/${locale}/abbonamento/${plan}`, languages: { ...langs, 'x-default': `${BASE}/it/abbonamento/${plan}` } },
  }
}

export default async function AbbonamentoProductPage({ params }: Props) {
  const { plan, locale } = await params
  if (!isValidPlan(plan)) notFound()

  const config = await getSubscriptionPlanConfig(plan, locale)
  if (!config) notFound()

  const t = await getTranslations('subscription.product')
  const product = config.product
  const firstImage = product.images?.[0]?.image?.url

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <div className="grid md:grid-cols-2 gap-10 mb-16">
        <div className="relative aspect-square rounded overflow-hidden" style={{ background: 'var(--muted)' }}>
          {firstImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={firstImage} alt={product.name} className="w-full h-full object-cover" />
          )}
        </div>
        <div>
          <h1 className="font-display text-4xl mb-4">{product.name}</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>{product.shortDescription}</p>
          <SubscribeCTA
            plan={plan}
            locale={locale}
            ctaLabel={t('subscribeCta')}
            loadingLabel={t('loading')}
            zonePickerLabel={t('zonePickerLabel')}
            tabIt={t('tabIt')}
            tabEu={t('tabEu')}
          />
        </div>
      </div>

      <SubscriptionRoadmap
        plan={plan}
        labels={{
          tabIt: t('tabIt'),
          tabEu: t('tabEu'),
          cycle1: t('cycle1'),
          cycle2: t('cycle2'),
          cycle6: t('cycle6'),
          shippingIncluded: t('shippingIncluded'),
          perMonth: t('perMonth'),
        }}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Verifica manuale**

Prerequisito: nel Payload admin (`cms` dev in esecuzione, `/admin`), crea manualmente due documenti in "Abbonamenti → Subscription Plans": `key=tattoo` collegato al prodotto XXL reale, `key=pmu` collegato al prodotto 3 Visi reale. Poi apri `/it/abbonamento/tattoo` e `/it/abbonamento/pmu`. Expected: foto e descrizione del prodotto reale, roadmap con tab Italia/Europa funzionante (click cambia i numeri), form email + bottone "Abbonati ora" presente.

- [ ] **Step 6: Commit**

```bash
git add storefront/src/app/\[locale\]/abbonamento/\[plan\] storefront/src/lib/cms.ts
git commit -m "feat(storefront): pagina prodotto abbonamento tattoo/pmu con roadmap e CTA"
```

---

### Task 13: Storefront — banner CTA in home

**Files:**
- Create: `storefront/src/components/SubscriptionBanner.tsx`
- Modify: `storefront/src/app/[locale]/page.tsx`
- Modify: `storefront/messages/{it,en,de,fr,es}.json`

**Interfaces:**
- Consumes: `getTranslations` (già importato in `page.tsx`).

- [ ] **Step 1: Aggiungi le chiavi al namespace `subscription` in tutti e 5 i file messages**

```json
"banner": {
  "eyebrow": "Novità",
  "title": "Abbonati alla tua pelle",
  "body": "Ricevi Tattoo XXL o PMU 3 Visi ogni mese. Dal secondo mese la spedizione è sul noi, dal sesto anche il -10%.",
  "cta": "Scopri l'abbonamento"
}
```
(tradotto per `en`/`de`/`fr`/`es` con lo stesso registro delle altre sezioni del file)

- [ ] **Step 2: Crea il componente banner**

```typescript
// storefront/src/components/SubscriptionBanner.tsx
import Link from 'next/link'

export function SubscriptionBanner({ locale, eyebrow, title, body, cta }: {
  locale: string
  eyebrow: string
  title: string
  body: string
  cta: string
}) {
  return (
    <section className="border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-7xl mx-auto px-8 md:px-16 py-20 flex flex-col items-start">
        <p className="text-xs font-bold tracking-[0.4em] uppercase mb-4" style={{ color: 'var(--accent)' }}>{eyebrow}</p>
        <h2 className="font-display text-4xl md:text-6xl leading-none mb-5">{title}</h2>
        <p className="text-sm leading-relaxed mb-8 max-w-md" style={{ color: 'var(--muted-fg)' }}>{body}</p>
        <Link
          href={`/${locale}/abbonamento`}
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-widest uppercase transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {cta} →
        </Link>
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Inserisci il banner nella home**

In `storefront/src/app/[locale]/page.tsx`, aggiungi l'import vicino agli altri:
```typescript
import { SubscriptionBanner } from '@/components/SubscriptionBanner'
```

Trova il blocco (circa riga 525-536):
```typescript
      {homepageReviews.length > 0 && (
        <ReviewQuote
          reviews={homepageReviews.map(r => ({
            rating: r.rating,
            body: r.body,
            reviewer_name: r.reviewer_name,
            product_slug: r.product_slug,
          }))}
          productNames={productNamesMap}
        />
      )}

      {/* ════════════════════════════════════════════════
          CTA FINALE — Chiusura forte
      ════════════════════════════════════════════════ */}
```

Inserisci il banner subito prima del commento `CTA FINALE`:
```typescript
      {homepageReviews.length > 0 && (
        <ReviewQuote
          reviews={homepageReviews.map(r => ({
            rating: r.rating,
            body: r.body,
            reviewer_name: r.reviewer_name,
            product_slug: r.product_slug,
          }))}
          productNames={productNamesMap}
        />
      )}

      <SubscriptionBanner
        locale={locale}
        eyebrow={t('subscription.banner.eyebrow')}
        title={t('subscription.banner.title')}
        body={t('subscription.banner.body')}
        cta={t('subscription.banner.cta')}
      />

      {/* ════════════════════════════════════════════════
          CTA FINALE — Chiusura forte
      ════════════════════════════════════════════════ */}
```

Verifica con `grep -n "getLocale\|const locale" storefront/src/app/\[locale\]/page.tsx` che `locale` sia già disponibile in questo scope (la funzione `HomePage` usa già `getLocale()` altrove nel file, riusa la stessa variabile — non chiamarla due volte).

- [ ] **Step 4: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Verifica manuale in browser**

Apri `/it`. Expected: nuova sezione visibile tra le recensioni e la CTA finale, con link funzionante verso `/it/abbonamento`.

- [ ] **Step 6: Commit**

```bash
git add storefront/src/components/SubscriptionBanner.tsx storefront/src/app/\[locale\]/page.tsx storefront/messages
git commit -m "feat(storefront): banner CTA abbonamento in home"
```

---

### Task 14: Storefront — cambio zona a metà abbonamento

**Files:**
- Modify: `storefront/src/lib/stripe-subscription-schedule.ts`
- Create: `storefront/src/app/api/account/subscription/change-zone/route.ts`
- Create: `storefront/src/app/(customer-app)/account/(protected)/abbonamento/_components/ChangeZoneButton.tsx`
- Modify: `storefront/src/app/(customer-app)/account/(protected)/abbonamento/page.tsx`

**Interfaces:**
- Consumes: `SUBSCRIPTION_LADDER`, `getPhaseIndexForCycle`, `PlanKey`, `Zone` (Task 4).
- Produces: `rebuildRemainingPhases(plan, currentZone, newZone, cyclesCompleted)` in `stripe-subscription-schedule.ts`; `POST /api/account/subscription/change-zone`.

Come da spec: cambiare zona **non azzera** `cyclesCompleted` — solo le fasi Stripe da questo momento in poi cambiano per riflettere la nuova zona. Il ciclo in corso (già fatturato) non viene toccato: il cambio si applica dal rinnovo successivo.

- [ ] **Step 1: Aggiungi `rebuildRemainingPhases` a `stripe-subscription-schedule.ts`**

```typescript
// aggiungi in fondo a storefront/src/lib/stripe-subscription-schedule.ts
import { getPhaseIndexForCycle, type Zone } from './subscription-plans'

/**
 * Ricostruisce le fasi Stripe da adesso in poi per riflettere la nuova zona,
 * preservando cyclesCompleted (nessun reset). La fase in corso di fatturazione
 * (quella che contiene "adesso") deve avere lo stesso start_date già assegnato
 * da Stripe — non possiamo riscrivere il passato di uno schedule esistente.
 */
export async function rebuildRemainingPhases(
  stripe: Stripe,
  scheduleId: string,
  plan: PlanKey,
  newZone: Zone,
  cyclesCompleted: number,
): Promise<Stripe.SubscriptionSchedule> {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  const currentPhaseStart = schedule.phases[schedule.phases.length - 1].start_date

  const nextCycle = cyclesCompleted + 1
  const currentPhaseIndex = getPhaseIndexForCycle(nextCycle)
  const newPhases = buildSchedulePhases(plan, newZone).slice(currentPhaseIndex)

  return stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: 'release',
    phases: [
      { ...newPhases[0], start_date: currentPhaseStart },
      ...newPhases.slice(1),
    ],
  })
}
```

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Crea la route di cambio zona**

```typescript
// storefront/src/app/api/account/subscription/change-zone/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSession } from '@/lib/account-auth'
import { rebuildRemainingPhases } from '@/lib/stripe-subscription-schedule'
import type { Zone } from '@/lib/subscription-plans'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { subscriptionDocId, newZone } = (await req.json()) as { subscriptionDocId: string; newZone: Zone }
  if (!subscriptionDocId || (newZone !== 'IT' && newZone !== 'EU')) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const docRes = await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
  })
  if (!docRes.ok) return NextResponse.json({ error: 'Abbonamento non trovato' }, { status: 404 })
  const doc = await docRes.json()

  if (doc.customerEmail?.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  if (doc.zone === newZone) {
    return NextResponse.json({ ok: true }) // nessun cambiamento
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  await rebuildRemainingPhases(stripe, doc.stripeScheduleId, doc.plan, newZone, doc.cyclesCompleted)

  await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
    body: JSON.stringify({ zone: newZone }),
  })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 5: Crea il bottone client**

```typescript
// storefront/src/app/(customer-app)/account/(protected)/abbonamento/_components/ChangeZoneButton.tsx
'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Zone } from '@/lib/subscription-plans'

export function ChangeZoneButton({ subscriptionDocId, currentZone, label }: {
  subscriptionDocId: string
  currentZone: Zone
  label: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const otherZone: Zone = currentZone === 'IT' ? 'EU' : 'IT'

  async function handleChange() {
    setLoading(true)
    const res = await fetch('/api/account/subscription/change-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionDocId, newZone: otherZone }),
    })
    setLoading(false)
    if (res.ok) router.refresh()
  }

  return (
    <button
      onClick={handleChange}
      disabled={loading}
      style={{
        background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)',
        borderRadius: '6px', padding: '8px 14px', fontSize: '11px', textTransform: 'uppercase',
        letterSpacing: '0.05em', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : `${label} ${otherZone === 'IT' ? 'Italia' : 'Europa'}`}
    </button>
  )
}
```

- [ ] **Step 6: Aggiungi il bottone alla pagina account (Task 9)**

In `storefront/src/app/(customer-app)/account/(protected)/abbonamento/page.tsx`, importa `ChangeZoneButton` e renderizzalo accanto a `CancelSubscriptionButton`, solo quando `sub.status === 'active'`:

```typescript
import { ChangeZoneButton } from './_components/ChangeZoneButton'
```

Nel blocco JSX dove oggi c'è solo `<CancelSubscriptionButton ... />`, avvolgi entrambi i bottoni in un contenitore flex:

```typescript
              {sub.status === 'canceling' ? (
                <span style={{ fontSize: '11px', color: '#c07a7a' }}>{t('subscription_canceling')}</span>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <ChangeZoneButton subscriptionDocId={sub.id} currentZone={sub.zone} label={t('subscription_change_zone')} />
                  <CancelSubscriptionButton
                    subscriptionDocId={sub.id}
                    label={t('subscription_cancel')}
                    confirmLabel={t('subscription_cancel')}
                  />
                </div>
              )}
```

Aggiungi la chiave `subscription_change_zone` (es. "Cambia zona:") in `account-translations.ts` per tutte le lingue, stesso pattern del Task 9 Step 1.

- [ ] **Step 7: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 8: Verifica manuale**

Con dati di test (una Subscription CMS con `stripeScheduleId` valido da Stripe test mode), chiama:
```bash
curl -s -X POST http://localhost:3000/api/account/subscription/change-zone \
  -H "Content-Type: application/json" -H "Cookie: foolish_session=<token di test>" \
  -d '{"subscriptionDocId":"<id>","newZone":"EU"}'
```
Expected: `{"ok":true}`, e nel Dashboard Stripe (test mode) lo schedule associato mostra le fasi future aggiornate al prezzo EU mantenendo invariata la fase corrente.

- [ ] **Step 9: Commit**

```bash
git add storefront/src/lib/stripe-subscription-schedule.ts storefront/src/app/api/account/subscription/change-zone storefront/src/app/\(customer-app\)/account/\(protected\)/abbonamento
git commit -m "feat(storefront): cambio zona IT/EU a metà abbonamento senza reset cicli"
```

---

## Dopo l'ultimo task

1. Esegui una volta il typecheck completo di entrambe le app: `cd storefront && npx tsc --noEmit && cd ../cms && npx tsc --noEmit`.
2. Esegui il passo manuale Stripe Dashboard descritto in Global Constraints (abilita `invoice.payment_succeeded` e `customer.subscription.deleted` sull'endpoint webhook).
3. Crea in Payload admin i due documenti `SubscriptionPlans` (tattoo/pmu) collegati ai prodotti reali (Task 12, Step 5) — senza questo le pagine `/abbonamento/tattoo` e `/abbonamento/pmu` danno 404.
4. Test end-to-end in Stripe test mode con un test clock (come da spec) prima del primo push: sottoscrivi un piano, avanza il clock di 1, poi altri 4, poi al 6° ciclo, verificando ogni volta l'Order creato in CMS e il valore corretto.
5. Nello stesso test, verifica anche il cambio zona (Task 14): a metà percorso (es. dopo 3 cicli) cambia zona dall'account e controlla che i cicli successivi fatturino secondo la nuova zona senza azzerare `cyclesCompleted`.
6. Un solo `git push origin main` finale, a tutte le modifiche completate (regola del progetto).
