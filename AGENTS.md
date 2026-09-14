# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

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

## Hermes → Codex engineering workflow

Hermes is the project director and the gate for diagnosis, review, promotion, and deployment. Alfred is the current Foolish operational runtime in Nanobot on the Pi; live runtime state must be checked separately.

For a coding task:

1. Hermes reads `PROJECT_CONTRACT.md`, the relevant architecture documentation, and this file.
2. Hermes diagnoses read-only first and writes a bounded task with affected files, constraints, acceptance criteria, and rollback expectations.
3. Codex works in a dedicated branch/worktree.
4. Codex runs the relevant typechecks, tests, lint/build checks, and reports literal output.
5. Codex returns the diff and evidence. It does **not** merge or push `main`.
6. Hermes reviews the diff, reruns verification, performs safe live checks, and decides whether promotion/deployment is acceptable.

Required baseline before promotion:

```bash
cd storefront && npx tsc --noEmit
cd ../cms && npx tsc --noEmit
```

## Pre-deploy gate (obbligatorio)

`scripts/release-gate.mjs` verifica i contratti fra file che i test non coprono (migration
registrate, metadata del checkout verso il webhook, parità delle traduzioni, segreti, lockfile).
Va eseguito prima di proporre una promozione, e gira da sé su ogni pull request
(`.github/workflows/ci.yml`).

```bash
node --test scripts/release-gate.test.mjs   # il gate stesso, casi negativi inclusi
node scripts/release-gate.mjs               # sul branch di lavoro
```

Un gate rosso non si aggira: si corregge la causa, oppure si spiega per iscritto perché il
controllo è sbagliato — e in quel caso si aggiorna il controllo con un test che lo prova.
Nessun workflow esegue deploy o migration: il deploy lo fa Railway dal merge su `main`, le
migration le applica il servizio CMS all'avvio.

Workers do not bypass Hermes, change production credentials, or perform external actions without the required approval. Historical `CLAUDE.md` instructions and Frank/nanobot pipeline descriptions are not operational authority and must not be followed.
