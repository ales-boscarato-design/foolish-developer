# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Overview

Monorepo for The Foolish Butcher e-commerce. Two Next.js apps sharing one PostgreSQL database on Railway EU:
- `storefront/` — customer-facing shop (thefoolishbutcher.com, port 3000)
- `cms/` — Payload CMS admin panel (admin.thefoolishbutcher.com, port 3001)

---

## Development Commands

**Storefront** (`storefront/`):
```bash
npm run dev        # dev server on port 3000
npm run build      # production build
npm run lint       # ESLint
npx tsc --noEmit   # type check
```

**CMS** (`cms/`):
```bash
npm run dev              # dev server on port 3001
npm run build            # build + generate Payload import map
npm run generate:types   # regenerate TypeScript types from schema
npx tsc --noEmit         # type check
```

**Before committing:** `cd storefront && npx tsc --noEmit && cd ../cms && npx tsc --noEmit`

---

## Architecture

### Data flow

```
CMS (Payload REST API at :3001) → storefront fetches products (ISR, 60s revalidation)
Customer cart → POST /api/stripe/checkout → Stripe → webhook → POST /api/webhook/stripe → CMS order + email
```

Product data is read-only from the storefront's perspective. Orders are created by the Stripe webhook handler, not by the customer browser directly.

### Database schemas

Both apps share a single `DATABASE_URL`. Two schemas:
- **CMS schema** (managed by Payload ORM, migrations in `cms/src/migrations/`): `products`, `orders`, `customers`, `media`, `users`, `pro_members`, `promo_codes`, `payload_*`
- **Storefront direct SQL** (`storefront/src/lib/marketing-db.ts`, `reviews-db.ts`): schemas `marketing` (email subscribers, abandoned carts) and `reviews` (product reviews). Uses `postgres` npm package with raw queries.

### Routing (storefront)

All customer-facing routes are under `[locale]` prefix (5 locales: it, en, de, fr, es). Key routes:
- `/[locale]/` — home (product grids by section)
- `/[locale]/prodotto/[slug]` — product detail
- `/[locale]/checkout` — cart/checkout (client-side)
- `/[locale]/grazie` — post-purchase thank-you
- `/[locale]/account` — customer account + order tracking
- `/ordine/[id]` — public order view (token-based, unlocalized)

Legacy WooCommerce URL redirects are in `storefront/next.config.ts`.

### CMS Collections

`cms/src/collections/`: Products, Orders, Customers, Media, ProMembers, PromoCodes, Users.

Products have localized fields (name, description, etc.) with Italian as default locale and fallback enabled. The live preview links to the storefront product page.

### Storefront API routes (`storefront/src/app/api/`)

| Route | Purpose |
|---|---|
| `stripe/checkout` | Create Stripe checkout session |
| `webhook/stripe` | Process `charge.succeeded`, create CMS order, send email |
| `order/[token]` | Public order lookup by token |
| `cron/abandoned-cart` | Abandoned cart recovery emails |
| `cron/review-request` | Post-purchase review request emails |
| `review/submit` | Submit product review |
| `promo/validate` | Validate promo codes |
| `marketing/stats` | Analytics endpoint (protected) |
| `address/autocomplete` | Address autocomplete |

### CMS image proxy

CMS media is proxied through `/cms-media/[...file]` in the storefront to avoid Next.js Image domain issues. This rewrites to `CMS_URL/api/media/file/...`.

### Email

Transactional emails use Resend + React Email templates (`storefront/src/emails/`). The Stripe webhook sends the order confirmation. Cron jobs handle abandoned cart and review requests.

---

## Modalità autonoma (Frank → Claude Code pipeline)

Quando invocato da Frank via `claude --print --dangerously-skip-permissions`:

1. Leggi il codice rilevante
2. Identifica root cause e fixa
3. Typecheck: `cd storefront && npx tsc --noEmit && cd ../cms && npx tsc --noEmit`
4. Se typecheck fallisce: risolvi e riprova
5. `git checkout -b fix/frank-<task_id>`
6. `git add -A && git commit -m "fix: <descrizione>"`
7. `git push -u origin fix/frank-<task_id>`
8. `git checkout main && git pull origin main && git merge --no-ff fix/frank-<task_id> -m "merge: fix/frank-<task_id>"`
9. `git push origin main` ← triggera il deploy Railway automatico via GitHub webhook
10. Termina stampando **solo** questo JSON (ultima riga, nient'altro dopo):
    `{"fixed": bool, "pushed": bool, "root_cause": "...", "changes": "...", "branch": "fix/frank-XXX", "notes": "..."}`

**Regole:** nessuna conferma, nessun dialogo. Se `git push origin main` fallisce per conflitti: risolvi e ripusha. Non committare mai con typecheck sporco.
