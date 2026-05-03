# Agents Guide — Foolish Storefront

## Repo structure

```
foolish-storefront/
├── storefront/          # Next.js 16 + next-intl storefront (thefoolishbutcher.com)
├── cms/                 # Payload CMS 2.x + Postgres (admin.thefoolishbutcher.com)
├── nanobot/             # LangGraph orchestration (Railway, production) — NOT in this repo
├── CLAUDE.md            # nanobot backend brief
├── FOOLISH_STOREFRONT.md # Phase 2 storefront brief
└── scripts/            # deployment helpers (translate.py only)
```

When this AGENTS.md conflicts with `CLAUDE.md`, the `CLAUDE.md` takes precedence.

---

## Storefront

- **Stack:** Next.js 16 (App Router), Tailwind CSS 4, next-intl 4, Stripe
- **Run dev:** `cd storefront && npm run dev` → `http://localhost:3000`
- **Build:** `cd storefront && npm run build`
- **Lint:** `cd storefront && npm run lint`
- **TypeScript:** strict mode

## Translations (next-intl)

- **Config:** `storefront/src/i18n/routing.ts` — locales: `['it','en','fr','es','de']`, default: `'it'`
- **Locale prefix mode:** `always` (not `as-needed`) — every route has locale prefix
- **Message files:** `storefront/messages/{locale}.json` — all 5 exist
- **Request config:** `storefront/src/i18n/request.ts`
- **Navigation helpers:** `storefront/src/i18n/navigation.ts` — exports `Link, redirect, useRouter, usePathname`
- **Component usage:** `<NextIntlClientProvider>` wraps children in `[locale]/layout.tsx`
- **Adding copy:** edit the right `messages/{locale}.json` file

## Pages (storefront/src/app/[locale]/)

```
page.tsx              → homepage
tattoo/page.tsx      → tattoo section
pmu/page.tsx         → PMU section
limited/page.tsx     → limited stock (only visible when populated)
prodotto/[slug]/     → product detail + Stripe checkout
checkout/page.tsx    → checkout page
grazie/page.tsx      → post-payment confirmation
ordine/              → order status (customer-facing, empty dir — not yet built)
contatti/page.tsx
privacy/page.tsx
termini/page.tsx
```

## CMS

- **Stack:** Payload CMS 2.x (TypeScript), Postgres (`foolish_cms` schema)
- **Run dev:** `cd cms && npm run dev` → port **3001** (not 3000)
- **Collections:** `products`, `orders`, `customers`
- **Payload and nanobot write to same Postgres** — `foolish.*` (orders/sheets) + `foolish_cms.*` (CMS)

## Deployment

- **Storefront:** Vercel — trigger from `storefront/` directory
- **CMS:** Railway EU — trigger from `cms/` directory
- **Nanobot:** Railway EU — separate repo/service
- **Env vars:** managed per-service on Railway/Vercel (not in repo)
- **No secrets in repo** — use env vars or `.env.local` (gitignored)

## Key conventions

- **Payload admin:** only Alessandro
- **Customer communication:** Italian primary (next-intl `it.json`)
- **Phase 2 brief:** `FOOLISH_STOREFRONT.md`
- **Backend brief:** `CLAUDE.md` (nanobot business line, takes precedence over this file)