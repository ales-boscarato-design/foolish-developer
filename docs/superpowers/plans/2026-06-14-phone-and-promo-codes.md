# Phone & Promo Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere il telefono obbligatorio al checkout e permettere la creazione di codici sconto con percentuale/importo personalizzati e data di scadenza.

**Architecture:** Il telefono viene raccolto nel form storefront, passato come metadata Stripe, estratto dal webhook e salvato su `Orders.customerPhone`. I nuovi tipi promo (`percent`, `amount`) vengono aggiunti alla collection CMS e gestiti in `/api/promo/validate`; il checkout UI estende già la logica di sconto per entrambi.

**Tech Stack:** Next.js 14 App Router, Payload CMS 3, TypeScript, Stripe

---

## File map

| File | Operazione |
|---|---|
| `cms/src/collections/Orders.ts` | Aggiunge campo `customerPhone` |
| `cms/src/collections/PromoCodes.ts` | Aggiunge tipi `percent`/`amount`, campi `discountPercent`, `discountAmount`, `expiresAt` |
| `storefront/src/app/api/promo/validate/route.ts` | Gestisce nuovi tipi + check scadenza |
| `storefront/src/app/api/stripe/checkout/route.ts` | Aggiunge `customer_phone` ai metadata Stripe |
| `storefront/src/app/api/webhook/stripe/route.ts` | Estrae `customer_phone` e lo passa a CMS |
| `storefront/src/app/[locale]/checkout/page.tsx` | Campo phone nel form, aggiorna logica promo |
| `storefront/messages/{it,en,de,fr,es}.json` | Aggiunge chiave `checkout.fields.phone` |

---

## Task 1: CMS — campo `customerPhone` in Orders

**Files:**
- Modify: `cms/src/collections/Orders.ts:562-565`

- [ ] **Step 1: Aggiungi il campo `customerPhone` dopo il blocco `customerTelegramId`/`customerLocale`**

  Trova il blocco (righe 560-566):
  ```typescript
  {
    type: 'row',
    fields: [
      { name: 'customerTelegramId', type: 'text', label: 'Telegram ID cliente', admin: { width: '50%' } },
      { name: 'customerLocale', type: 'text', label: 'Lingua (es. it, en)', admin: { width: '50%' } },
    ],
  },
  ```

  Sostituiscilo con:
  ```typescript
  {
    type: 'row',
    fields: [
      { name: 'customerTelegramId', type: 'text', label: 'Telegram ID cliente', admin: { width: '50%' } },
      { name: 'customerLocale', type: 'text', label: 'Lingua (es. it, en)', admin: { width: '50%' } },
    ],
  },
  { name: 'customerPhone', type: 'text', label: 'Telefono cliente' },
  ```

- [ ] **Step 2: Typecheck CMS**

  ```bash
  cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
  ```
  Expected: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/ab/dev/foolish-storefront
  git add cms/src/collections/Orders.ts
  git commit -m "feat(cms): add customerPhone field to Orders collection"
  ```

---

## Task 2: CMS — estendi PromoCodes con nuovi tipi e scadenza

**Files:**
- Modify: `cms/src/collections/PromoCodes.ts`

- [ ] **Step 1: Riscrivi il file `cms/src/collections/PromoCodes.ts`**

  ```typescript
  import type { CollectionConfig } from 'payload'

  export const PromoCodes: CollectionConfig = {
    slug: 'promo-codes',
    admin: {
      useAsTitle: 'code',
      defaultColumns: ['code', 'type', 'active', 'expiresAt', 'usageCount'],
      group: 'Foolish Pro',
    },
    access: {
      read: () => true,
      create: ({ req }) => !!req.user,
      update: ({ req }) => !!req.user,
      delete: ({ req }) => !!req.user,
    },
    fields: [
      { name: 'code', type: 'text', required: true, unique: true, label: 'Codice' },
      {
        name: 'type',
        type: 'select',
        required: true,
        label: 'Tipo',
        options: [
          { label: 'Spedizione gratuita', value: 'free_shipping' },
          { label: 'Sconto % Pro',        value: 'percent_pro' },
          { label: 'Sconto %',            value: 'percent' },
          { label: 'Sconto importo fisso (€)', value: 'amount' },
        ],
      },
      {
        name: 'discountPercent',
        type: 'number',
        label: 'Percentuale sconto (%)',
        admin: {
          condition: (data) => data.type === 'percent',
          description: 'Es. 20 per il 20% di sconto',
        },
      },
      {
        name: 'discountAmount',
        type: 'number',
        label: 'Importo sconto (€)',
        admin: {
          condition: (data) => data.type === 'amount',
          description: 'Es. 15 per €15 di sconto',
        },
      },
      { name: 'active', type: 'checkbox', defaultValue: true, label: 'Attivo' },
      {
        name: 'expiresAt',
        type: 'date',
        label: 'Scadenza',
        admin: {
          description: 'Lascia vuoto per codice senza scadenza',
          date: { pickerAppearance: 'dayOnly', displayFormat: 'dd/MM/yyyy' },
        },
      },
      {
        name: 'proMember',
        type: 'relationship',
        relationTo: 'pro-members' as 'users',
        required: false,
        label: 'Membro Pro',
      },
      { name: 'usageCount', type: 'number', defaultValue: 0, label: 'Utilizzi', admin: { readOnly: true } },
    ],
    timestamps: true,
  }
  ```

- [ ] **Step 2: Typecheck CMS**

  ```bash
  cd /home/ab/dev/foolish-storefront/cms && npx tsc --noEmit
  ```
  Expected: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/ab/dev/foolish-storefront
  git add cms/src/collections/PromoCodes.ts
  git commit -m "feat(cms): add percent/amount promo types and expiresAt field"
  ```

---

## Task 3: Storefront — `/api/promo/validate` — nuovi tipi e scadenza

**Files:**
- Modify: `storefront/src/app/api/promo/validate/route.ts`

- [ ] **Step 1: Riscrivi `storefront/src/app/api/promo/validate/route.ts`**

  ```typescript
  import { NextRequest, NextResponse } from 'next/server'
  import { getOfferByCode } from '@/lib/account-db'

  export const dynamic = 'force-dynamic'

  const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

  function getCodes(): Record<string, string> {
    try {
      return JSON.parse(process.env.PROMO_CODES || '{}')
    } catch {
      return {}
    }
  }

  function calcProDiscount(total: number): { discountPercent: number; discountAmount: number } {
    const discountPercent = total >= 400 ? 20 : 15
    const discountAmount = parseFloat(((total * discountPercent) / 100).toFixed(2))
    return { discountPercent, discountAmount }
  }

  function isExpired(expiresAt: string | null | undefined): boolean {
    if (!expiresAt) return false
    return new Date(expiresAt) < new Date()
  }

  export async function POST(req: NextRequest) {
    const body = await req.json()
    const { code, total } = body as { code?: string; total?: number }

    if (!code || typeof code !== 'string') {
      return NextResponse.json({ valid: false })
    }

    const normalizedCode = code.toUpperCase().trim()

    // 1. Check CMS PromoCodes
    try {
      const cmsRes = await fetch(
        `${CMS_URL}/api/promo-codes?where[code][equals]=${encodeURIComponent(normalizedCode)}&where[active][equals]=true&depth=0&limit=1`,
        { cache: 'no-store' },
      )
      if (cmsRes.ok) {
        const cmsData = await cmsRes.json()
        const cmsCode = cmsData.docs?.[0]
        if (cmsCode) {
          if (isExpired(cmsCode.expiresAt)) {
            return NextResponse.json({ valid: false })
          }
          if (cmsCode.type === 'percent_pro') {
            const cartTotal = typeof total === 'number' && total > 0 ? total : 0
            const { discountPercent, discountAmount } = calcProDiscount(cartTotal)
            return NextResponse.json({ valid: true, type: 'percent_pro', discountPercent, discountAmount })
          }
          if (cmsCode.type === 'percent') {
            const cartTotal = typeof total === 'number' && total > 0 ? total : 0
            const discountPercent = cmsCode.discountPercent as number
            const discountAmount = parseFloat(((cartTotal * discountPercent) / 100).toFixed(2))
            return NextResponse.json({ valid: true, type: 'percent', discountPercent, discountAmount })
          }
          if (cmsCode.type === 'amount') {
            const discountAmount = cmsCode.discountAmount as number
            return NextResponse.json({ valid: true, type: 'amount', discountAmount })
          }
          // free_shipping
          return NextResponse.json({ valid: true, type: cmsCode.type })
        }
      }
    } catch {
      // CMS unreachable — fall through to env var
    }

    // 2. Check customer offers (post-order personal offers)
    try {
      const offer = await getOfferByCode(normalizedCode)
      if (offer) {
        const cartTotal = typeof total === 'number' && total > 0 ? total : 0
        const discountAmount = parseFloat(((cartTotal * offer.discount_percent) / 100).toFixed(2))
        return NextResponse.json({ valid: true, type: 'percent_offer', discountPercent: offer.discount_percent, discountAmount })
      }
    } catch {
      // DB unreachable — fall through
    }

    // 3. Fallback: env var PROMO_CODES
    const codes = getCodes()
    const type = codes[normalizedCode]
    if (!type) return NextResponse.json({ valid: false })
    return NextResponse.json({ valid: true, type })
  }
  ```

- [ ] **Step 2: Typecheck storefront**

  ```bash
  cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
  ```
  Expected: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/ab/dev/foolish-storefront
  git add storefront/src/app/api/promo/validate/route.ts
  git commit -m "feat: handle percent/amount promo types and expiry in validate route"
  ```

---

## Task 4: Storefront — `/api/stripe/checkout` — phone nei metadata

**Files:**
- Modify: `storefront/src/app/api/stripe/checkout/route.ts`

- [ ] **Step 1: Aggiungi `phone` ai metadata Stripe**

  Trova la riga (riga 22):
  ```typescript
  const { items, shippingCost, customer, discountAmount, discountLabel } = await req.json()
  ```
  Sostituisci con:
  ```typescript
  const { items, shippingCost, customer, discountAmount, discountLabel } = await req.json()
  const phone: string = customer?.phone ?? ''
  ```

  Trova il blocco `metadata` (righe 65-79):
  ```typescript
  metadata: {
    order_ref: orderRef,
    customer_name: customer.name,
    customer_country: customer.country,
    customer_address: `${customer.address}|${customer.city}|${customer.postalCode}`,
    items_json: JSON.stringify(
      items.map((i: CartItem) => ({
        sku: i.sku,
        qty: i.quantity,
        name: i.productName,
        variantLabel: i.variantLabel,
        price: i.price,
      })),
    ),
  },
  ```
  Sostituisci con:
  ```typescript
  metadata: {
    order_ref: orderRef,
    customer_name: customer.name,
    customer_country: customer.country,
    customer_address: `${customer.address}|${customer.city}|${customer.postalCode}`,
    customer_phone: phone,
    items_json: JSON.stringify(
      items.map((i: CartItem) => ({
        sku: i.sku,
        qty: i.quantity,
        name: i.productName,
        variantLabel: i.variantLabel,
        price: i.price,
      })),
    ),
  },
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
  ```
  Expected: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/ab/dev/foolish-storefront
  git add storefront/src/app/api/stripe/checkout/route.ts
  git commit -m "feat: pass customer phone to Stripe session metadata"
  ```

---

## Task 5: Storefront — webhook Stripe — estrai phone e salvalo nel CMS

**Files:**
- Modify: `storefront/src/app/api/webhook/stripe/route.ts:41-127`

- [ ] **Step 1: Estrai `customer_phone` dal metadata e includilo nel body CMS**

  In `createOrderInCMS`, trova la riga (riga 43):
  ```typescript
  const customerName = meta.customer_name ?? session.customer_details?.name ?? ''
  ```
  Aggiungi subito dopo:
  ```typescript
  const customerPhone = meta.customer_phone ?? ''
  ```

  Poi trova il corpo del POST al CMS (righe 110-122):
  ```typescript
  body: JSON.stringify({
    orderNumber: orderRef,
    source: 'storefront',
    customerEmail,
    customerName,
    lineItems,
    total,
    shippingCost,
    shippingAddress,
    customerLocale,
    pipelineState: 'received',
  }),
  ```
  Sostituisci con:
  ```typescript
  body: JSON.stringify({
    orderNumber: orderRef,
    source: 'storefront',
    customerEmail,
    customerName,
    customerPhone: customerPhone || undefined,
    lineItems,
    total,
    shippingCost,
    shippingAddress,
    customerLocale,
    pipelineState: 'received',
  }),
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
  ```
  Expected: nessun errore.

- [ ] **Step 3: Commit**

  ```bash
  cd /home/ab/dev/foolish-storefront
  git add storefront/src/app/api/webhook/stripe/route.ts
  git commit -m "feat: extract and save customerPhone from Stripe webhook metadata"
  ```

---

## Task 6: Storefront — checkout UI — campo phone + display promo aggiornato

**Files:**
- Modify: `storefront/src/app/[locale]/checkout/page.tsx`
- Modify: `storefront/messages/it.json`, `en.json`, `de.json`, `fr.json`, `es.json`

### 6a — Aggiungi chiave `phone` alle traduzioni

- [ ] **Step 1: Aggiungi `"phone"` in tutti i file messages**

  In ognuno dei 5 file, nel blocco `checkout.fields`, aggiungi la chiave `phone` dopo `fiscalCode`.

  **`storefront/messages/it.json`** — nel blocco `checkout.fields`:
  ```json
  "phone": "Numero di telefono"
  ```

  **`storefront/messages/en.json`**:
  ```json
  "phone": "Phone number"
  ```

  **`storefront/messages/de.json`**:
  ```json
  "phone": "Telefonnummer"
  ```

  **`storefront/messages/fr.json`**:
  ```json
  "phone": "Numéro de téléphone"
  ```

  **`storefront/messages/es.json`**:
  ```json
  "phone": "Número de teléfono"
  ```

### 6b — Aggiorna `checkout/page.tsx`

- [ ] **Step 2: Aggiungi `phone` al form state e stato `phoneError`**

  Trova (riga 58):
  ```typescript
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', postalCode: '' })
  ```
  Sostituisci con:
  ```typescript
  const [form, setForm] = useState({ name: '', email: '', address: '', city: '', postalCode: '', phone: '' })
  ```

  Trova (riga 73):
  ```typescript
  const [postalCodeError, setPostalCodeError] = useState(false)
  ```
  Aggiungi subito dopo:
  ```typescript
  const [phoneError, setPhoneError] = useState(false)
  ```

- [ ] **Step 3: Aggiungi validazione phone e aggiorna `canPay`**

  Trova (riga 110):
  ```typescript
  const validatePostalCode = (code: string, c: string) => {
  ```
  Aggiungi prima di questa funzione:
  ```typescript
  const validatePhone = (phone: string) => /^[\d\s+\-()\u00AD]{6,}$/.test(phone.trim())

  ```

  Trova (righe 115-119):
  ```typescript
  const canPay =
    !loading &&
    !!form.name && !!form.email && !!form.address && !!form.city && !!form.postalCode &&
    emailStatus !== 'invalid' &&
    (!billingDifferent || (!!billing.name && !!billing.address && !!billing.city && !!billing.postalCode))
  ```
  Sostituisci con:
  ```typescript
  const canPay =
    !loading &&
    !!form.name && !!form.email && !!form.address && !!form.city && !!form.postalCode &&
    !!form.phone && !phoneError &&
    emailStatus !== 'invalid' &&
    (!billingDifferent || (!!billing.name && !!billing.address && !!billing.city && !!billing.postalCode))
  ```

- [ ] **Step 4: Aggiorna `inputStyle` per gestire `phone`**

  Trova (righe 244-248):
  ```typescript
  const isInvalid =
    (field === 'email' && emailStatus === 'invalid') ||
    (field === 'postalCode' && postalCodeError)
  const isValid = overrideValid ||
    (field === 'email' && emailStatus === 'valid') ||
    (field === 'postalCode' && !postalCodeError && !!form.postalCode)
  ```
  Sostituisci con:
  ```typescript
  const isInvalid =
    (field === 'email' && emailStatus === 'invalid') ||
    (field === 'postalCode' && postalCodeError) ||
    (field === 'phone' && phoneError)
  const isValid = overrideValid ||
    (field === 'email' && emailStatus === 'valid') ||
    (field === 'postalCode' && !postalCodeError && !!form.postalCode) ||
    (field === 'phone' && !phoneError && !!form.phone)
  ```

- [ ] **Step 5: Aggiorna `proDiscount` per gestire i nuovi tipi promo**

  Trova (riga 106):
  ```typescript
  const proDiscount = promoType === 'percent_pro' ? (promoData?.discountAmount ?? 0) : 0
  ```
  Sostituisci con:
  ```typescript
  const proDiscount = (promoType === 'percent_pro' || promoType === 'percent' || promoType === 'amount')
    ? (promoData?.discountAmount ?? 0)
    : 0
  ```

- [ ] **Step 6: Aggiorna `applyPromo` per settare `promoData` con i nuovi tipi**

  Trova (righe 135-137):
  ```typescript
  setPromoData(data.type === 'percent_pro'
    ? { discountPercent: data.discountPercent, discountAmount: data.discountAmount }
    : null)
  ```
  Sostituisci con:
  ```typescript
  setPromoData(data.type === 'percent_pro' || data.type === 'percent'
    ? { discountPercent: data.discountPercent, discountAmount: data.discountAmount }
    : data.type === 'amount'
    ? { discountAmount: data.discountAmount }
    : null)
  ```

- [ ] **Step 7: Aggiorna `handlePayment` — `discountLabel` per i nuovi tipi**

  Trova (righe 211-212):
  ```typescript
  discountAmount: proDiscount > 0 ? proDiscount : undefined,
  discountLabel: promoData?.discountPercent ? `Sconto Foolish Pro ${promoData.discountPercent}%` : undefined,
  ```
  Sostituisci con:
  ```typescript
  discountAmount: proDiscount > 0 ? proDiscount : undefined,
  discountLabel: promoType === 'percent_pro' && promoData?.discountPercent
    ? `Sconto Foolish Pro ${promoData.discountPercent}%`
    : promoType === 'percent' && promoData?.discountPercent
    ? `Sconto ${promoData.discountPercent}%`
    : promoType === 'amount'
    ? 'Sconto promozionale'
    : undefined,
  phone: form.phone,
  ```

  Nota: `phone` viene aggiunto al body della chiamata API qui; la route checkout lo legge da `customer.phone` — ma in realtà viene passato come `customer: { ...form, country }` che ora include `phone` automaticamente perché è nel form state.

  Verifica che la riga con `customer:` sia:
  ```typescript
  customer: { ...form, country },
  ```
  Se sì, `customer.phone` sarà già incluso — rimuovi `phone: form.phone` aggiunto sopra (è ridondante).

- [ ] **Step 8: Aggiungi input phone nel form UI — dopo il blocco email (dopo riga 451)**

  Trova la chiusura del blocco email (riga 451):
  ```typescript
            </div>

            {/* Address + Nominatim autocomplete */}
  ```
  Inserisci il campo phone TRA la chiusura del blocco email e il commento `{/* Address`:
  ```tsx
            </div>

            {/* Phone */}
            <div>
              <div className="relative">
                <input
                  type="tel"
                  placeholder={t('fields.phone')}
                  value={form.phone}
                  onChange={(e) => { setForm(f => ({ ...f, phone: e.target.value })); if (phoneError) setPhoneError(false) }}
                  onFocus={() => setFocusedField('phone')}
                  onBlur={(e) => { setFocusedField(null); if (e.target.value) setPhoneError(!validatePhone(e.target.value)) }}
                  className={`${inputBase} pr-8`}
                  style={inputStyle('phone')}
                />
                {phoneError && <XCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--limited)' }} />}
                {!phoneError && form.phone && <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#5a9c52' }} />}
              </div>
              {phoneError && (
                <p className="text-xs mt-1" style={{ color: 'var(--limited)' }}>Numero di telefono non valido</p>
              )}
            </div>

            {/* Address + Nominatim autocomplete */}
  ```

- [ ] **Step 9: Aggiorna il display del promo applicato nel sidebar — mostra importo fisso**

  Trova (riga 691):
  ```tsx
                    {promoCode} · {promoData?.discountPercent ? `−${promoData.discountPercent}%` : 'Spedizione gratuita'}
  ```
  Sostituisci con:
  ```tsx
                    {promoCode} · {
                      promoData?.discountPercent
                        ? `−${promoData.discountPercent}%`
                        : promoType === 'amount' && promoData?.discountAmount
                        ? `−€${promoData.discountAmount.toFixed(2)}`
                        : 'Spedizione gratuita'
                    }
  ```

- [ ] **Step 10: Typecheck storefront**

  ```bash
  cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit
  ```
  Expected: nessun errore.

- [ ] **Step 11: Commit**

  ```bash
  cd /home/ab/dev/foolish-storefront
  git add storefront/src/app/[locale]/checkout/page.tsx storefront/messages/it.json storefront/messages/en.json storefront/messages/de.json storefront/messages/fr.json storefront/messages/es.json
  git commit -m "feat: add mandatory phone field and support percent/amount promo types in checkout"
  ```

---

## Task 7: Typecheck completo + deploy

- [ ] **Step 1: Typecheck completo**

  ```bash
  cd /home/ab/dev/foolish-storefront/storefront && npx tsc --noEmit && cd ../cms && npx tsc --noEmit
  ```
  Expected: nessun errore da nessuno dei due package.

- [ ] **Step 2: Deploy**

  ```bash
  cd /home/ab/dev/foolish-storefront && git push origin main
  ```
  Railway rideploya automaticamente via webhook GitHub.

- [ ] **Step 3: Verifica in produzione**

  1. Apri `https://thefoolishbutcher.com/it/checkout`
  2. Verifica che il campo "Numero di telefono" appaia tra email e indirizzo
  3. Verifica che il pulsante "Paga" sia disabilitato se il campo è vuoto o il formato è invalido
  4. Vai nel CMS Payload → Promo Codes → Crea un codice nuovo:
     - Tipo "Sconto %" → inserisci 20 → salva → testa il codice al checkout
     - Tipo "Sconto importo fisso" → inserisci 15 → salva → testa il codice
     - Imposta una data di scadenza passata → verifica che il codice ritorni non valido
  5. Completa un ordine di test → verifica nel CMS → campo "Telefono cliente" compilato
