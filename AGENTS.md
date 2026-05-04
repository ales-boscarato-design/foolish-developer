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

- **Storefront:** Railway EU — Dockerfile-based deployment (`builder: DOCKERFILE`, `dockerfilePath: storefront/Dockerfile`)
- **CMS:** Railway EU — Dockerfile-based deployment
- **Nanobot:** Railway EU — separate repo/service
- **Env vars:** managed per-service on Railway/Vercel (not in repo)
- **No secrets in repo** — use env vars or `.env.local` (gitignored)

## Railway domain port — critical setting

**The domain `targetPort` in Railway MUST be 443, not the container port (8080).**

Railway terminates TLS at the edge. If the domain port is set to 8080 (container port), the redirect URL after locale switching will incorrectly include `:8080`. If the domain port is set to 443, redirects work correctly with no port appended.

To verify/configure:
```bash
railway environment config --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(json.dumps(d['services']['ab2a4592-aa29-44cf-a134-569a8eea9c87']['networking'], indent=2))"
```

The correct config: `"port": 443` on the service domain.

## Locale redirect bug (2026-05-04) — resolved

**Symptom:** After switching from IT to another language and back, redirects appended `:8080` to the domain (e.g., `https://foolish-storefront-production.up.railway.app:8080/it/tattoo`), causing crashes.

**Root cause:** Railway domain `targetPort` was set to `8080` (the container's internal port) instead of `443` (standard HTTPS). Railway's CDN/Edge uses this port when constructing redirect URLs in the `location` header. next-intl's middleware correctly computes the redirect URL, but the Edge appends the domain's `targetPort`.

**Fix:** Changed the Railway domain port from 8080 to 443 via `railway environment edit --json`. No code change needed in middleware or routing.

**If the bug returns:** Check `railway environment config` and ensure the service domain has `"port": 443`, not `8080`.

## Key conventions

- **Payload admin:** only Alessandro
- **Customer communication:** Italian primary (next-intl `it.json`)
- **Phase 2 brief:** `FOOLISH_STOREFRONT.md`
- **Backend brief:** `CLAUDE.md` (nanobot business line, takes precedence over this file)