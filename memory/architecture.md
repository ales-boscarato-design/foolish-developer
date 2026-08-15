---
name: Architecture overview
description: Stack, flusso dati e dipendenze tra Storefront, CMS, Alfred e Stripe
type: project
---

## Stack

- Storefront: Next.js 16, React 19, App Router, next-intl (IT/EN/FR/ES/DE).
- B2B: applicazione Next.js separata nello stesso monorepo.
- CMS: Payload 3 + PostgreSQL, schema `foolish_cms`.
- Pagamenti: Stripe Checkout.
- Backoffice agentico: Alfred sulla Raspberry Pi, runtime in `/home/nanobot-admin/foolish-core`.
- Pacchetto di staging/configurazione Alfred sul computer di sviluppo: `/home/ab/nano-py`.
- Repository di produzione: `ales-boscarato-design/foolish-developer`.

## Flusso ordine Storefront

1. Lo storefront crea una Checkout Session tramite `POST /api/stripe/checkout`.
2. Stripe invia `checkout.session.completed` a `POST /api/webhook/stripe`.
3. Il webhook crea l'ordine nel CMS con `x-storefront-secret` e fallisce esplicitamente se il CMS non conferma la scrittura; Stripe può quindi ritentare.
4. La persistenza è idempotente su `orderNumber` e gestisce anche la race di unicità.
5. `cron-stripe-reconcile` ricontrolla ogni 15 minuti gli ultimi 30 giorni e recupera gli ordini pagati mancanti.
6. `cron-stripe-audit-daily` ricontrolla ogni giorno gli ultimi 365 giorni e invia un heartbeat.
7. Dopo la creazione, Payload invia conferma cliente e notifica amministrativa tramite Resend.
8. Ai cambi di `pipelineState`, Payload notifica Alfred su `/hooks/foolish-order-state`.

## Alfred

- Endpoint pubblico: `https://alfred.thefoolishbutcher.com`.
- Frank non fa parte del flusso ordini corrente.
- Produttori Railway: `NANOBOT_WEBHOOK_SECRET`.
- Ricevitore Alfred: `FOOLISH_STOREFRONT_WH_SECRET`.
- I due nomi devono contenere lo stesso valore.
- Firma: `x-foolish-signature: sha256=<hmac>` calcolata su `<timestamp>.<body>`.
- Timestamp: header `x-foolish-timestamp`, finestra massima cinque minuti.
- Alfred rifiuta configurazioni mancanti o firme non valide e deduplica gli eventi autenticati.

## Variabili critiche Storefront

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
- `PAYLOAD_PUBLIC_URL`, `PAYLOAD_API_SECRET`.
- `CRON_SECRET`.
- `NANOBOT_WEBHOOK_URL`, `NANOBOT_WEBHOOK_SECRET`.
- `RESEND_API_KEY`, `ADMIN_EMAIL`, `EMAIL_FROM`.
- `STOREFRONT_URL`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.

## Variabili critiche CMS

- `DATABASE_URL`, `PAYLOAD_SECRET`, `PAYLOAD_PUBLIC_URL`, `PAYLOAD_API_SECRET`.
- `STOREFRONT_URL` per CORS/CSRF.
- `NANOBOT_WEBHOOK_URL`, `NANOBOT_WEBHOOK_SECRET`.
- `RESEND_API_KEY`, `ADMIN_EMAIL`, `EMAIL_FROM`.

## Railway production

- CMS: `cms-production-1e56.up.railway.app`.
- Storefront: `thefoolishbutcher.com`.
- B2B, CMS e Storefront sono servizi distinti collegati allo stesso repository.
- PostgreSQL e Valkey sono servizi separati nello stesso progetto Railway.
- I cron Stripe sono servizi Railway indipendenti basati su `curlimages/curl`.
