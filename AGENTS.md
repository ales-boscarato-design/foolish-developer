# Agents Guide — Foolish Storefront

## Repo structure

```
foolish-storefront/
├── storefront/          # Next.js 16 + next-intl storefront (thefoolishbutcher.com)
├── cms/                 # Payload CMS 2.x + Postgres (admin.thefoolishbutcher.com)
├── nanobot/             # LangGraph orchestration (Railway, production)
├── CLAUDE.md            # nanobot backend brief
├── FOOLISH_STOREFRONT.md # Phase 2 storefront brief
└── scripts/            # deployment helpers
```

When this AGENTS.md conflicts with any `CLAUDE.md`, the `CLAUDE.md` takes precedence.

---

## Storefront

- **Stack:** Next.js 16 (App Router), Tailwind CSS 4, next-intl 4, Stripe
- **Run dev:** `cd storefront && npm run dev` → `http://localhost:3000`
- **Build:** `cd storefront && npm run build`
- **Lint:** `cd storefront && npm run lint`
- **Entry pages:** `storefront/src/app/[locale]/page.tsx` (dynamic locale segment)
- **Global layout:** `storefront/src/app/[locale]/layout.tsx`

## Translations (next-intl)

- **Config:** `storefront/src/i18n/routing.ts` — locales: `['it','en','fr','es','de']`, default: `'it'`
- **Message files:** `storefront/messages/{locale}.json`
- **Only `it.json` exists.** Adding a new locale = create `storefront/messages/{locale}.json` + restart dev
- **Request config:** `storefront/src/i18n/request.ts`
- **Navigation helpers:** `storefront/src/i18n/navigation.ts` — exports `Link, redirect, useRouter, usePathname` with locale-aware routing
- **Locale prefix mode:** `as-needed` — `/it` → `/`, `/en` → `/en`
- **Component usage:** `<NextIntlClientProvider>` wraps children in `[locale]/layout.tsx`
- Adding copy = edit the right `messages/{locale}.json` file

## CMS

- **Stack:** Payload CMS 2.x (TypeScript), Postgres (`foolish_cms` schema)
- **Run dev:** `cd cms && npm run dev` (default port 3000, configure `PORT` env)
- **Collections:** `products`, `orders`, `customers`
- **Payload reads/writes same Postgres** as nanobot Phase 1 pipeline — both write to `foolish.*` and `foolish_cms.*`

## Deployment

- Storefront: Vercel (frontend) — trigger deploy from `storefront/` directory
- CMS: Railway EU — trigger from `cms/` directory
- Nanobot: Railway EU — separate service
- Environment variables: managed per-service on Railway/Vercel (not in repo)

## Key conventions

- No secrets in repo — use env vars or `.env.local` (gitignored)
- Payload admin: only Alessandro
- Customer communication: Italian primary (next-intl `it.json`)
- Phase 2 brief: `FOOLISH_STOREFRONT.md`
- Backend brief: `CLAUDE.md` (nanobot business line)
