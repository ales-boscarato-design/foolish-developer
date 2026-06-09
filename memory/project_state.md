---
name: Go-live sprint state
description: Stato attuale del go-live foolish-storefront, cosa è risolto e cosa manca
type: project
---

Sessione 2026-05-30: go-live sprint. Progetto ~80% pronto.

**Fix completati in questa sessione:**
1. `stripe/session/route.ts` — aggiunto `expand: ['line_items.data.price']` su session.retrieve (line_items erano sempre null)
2. `app/not-found.tsx` + `app/error.tsx` — creati (mancavano, Next.js crashava)
3. `cms/src/payload.config.ts` — nodemailerAdapter effettivamente configurato (era importato ma non usato)
4. `storefront/next.config.ts` — security headers aggiunti (CSP, HSTS, X-Frame-Options, etc.)
5. `webhook/stripe/route.ts` — ora crea ordine in Payload CMS prima di notificare nanobot

**Ancora da fare (Tier 1):**
- `PAYLOAD_API_TOKEN`: eseguire `generate-api-token.ts` contro CMS production (step manuale)
- SMTP: configurare env Railway `SMTP_HOST/USER/PASS` (Resend o altro provider)
- Test end-to-end: `stripe listen --forward-to localhost:3000/api/webhook/stripe`
- Seed prodotti reali in CMS (gli 8 attuali sono generici)
- Deploy Railway storefront (non ancora deployato)

**NANOBOT_WEBHOOK_URL problema aperto:**
In produzione Railway, nanobot gira su macchina locale Alessandro (127.0.0.1:18790).
Il webhook storefront non può raggiungere localhost. Opzioni da discutere:
- Esporre nanobot pubblicamente (tunnel/Railway service)
- Skippare notify nanobot al lancio (già gestito con if(nanobotUrl))
- n8n come intermediario

**Tier 2 (entro lancio):**
- sitemap.ts + robots.ts mancanti
- afterChange hook su Orders per notify nanobot da CMS
- FSM validation sulle transizioni di stato ordine

**Media:** ancora ephemeral su filesystem Railway. Tier 3 ma bloccante per foto prodotto su redeploy.

**Why:** preparare go-live su thefoolishbutcher.com rimpiazzando WooCommerce legacy.
**How to apply:** priorità assoluta è stabilità deploy + checkout funzionante end-to-end.
