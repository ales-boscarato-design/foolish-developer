---
name: Architecture overview
description: Stack, flusso dati, dipendenze tra storefront/CMS/nanobot/Stripe
type: project
---

**Stack:**
- Storefront: Next.js 16 (app router, react 19, next-intl 5 lingue)
- CMS: Payload 3 + PostgreSQL (schema `foolish_cms`)
- Payments: Stripe Checkout (session mode)
- Nanobot: servizio Python su macchina locale Alessandro (non su Railway)

**Flusso ordine:**
1. Utente → storefront checkout → `POST /api/stripe/checkout` → Stripe session URL
2. Utente paga su Stripe → `checkout.session.completed` webhook → `POST /api/webhook/stripe`
3. Webhook: crea ordine in Payload CMS (`POST cms/api/orders`, autenticazione non richiesta per create)
4. Webhook: notifica nanobot se `NANOBOT_WEBHOOK_URL` presente (opzionale, fire-and-forget)
5. `GET /api/stripe/session?session_id=` usata dalla pagina /grazie per mostrare dettagli — richiede `expand: ['line_items.data.price']`
6. `GET /api/ordine/lookup?orderNumber=&email=` — legge ordine da Payload CMS con Bearer token

**Env vars critiche storefront:**
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` — Stripe
- `PAYLOAD_PUBLIC_URL` — URL CMS production (Railway)
- `PAYLOAD_API_TOKEN` — da generare con generate-api-token.ts
- `NANOBOT_WEBHOOK_URL` — opzionale, se assente nanobot non viene notificato
- `STOREFRONT_URL` — URL storefront production
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` — username bot Telegram per deep link

**Env vars critiche CMS:**
- `DATABASE_URL` — PostgreSQL Railway
- `PAYLOAD_SECRET` — secret per JWT
- `PAYLOAD_PUBLIC_URL` — URL pubblico CMS
- `STOREFRONT_URL` — per CORS/CSRF
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — nodemailer
- `EMAIL_FROM` — from address email

**DB:**
- PostgreSQL Railway EU
- Schema `foolish_cms`: gestito da Payload migrations (in `cms/src/migrations/`)
- Schema `foolish.*`: gestito da nanobot Phase 1 (ordini WooCommerce legacy, sheets, etc.)
- Due schemi separati sullo stesso PostgreSQL

**Railway services:**
- CMS: `cms-production-1dda.up.railway.app` — UP
- Storefront: non ancora deployato
