# Email Marketing Infrastructure — Design Spec

**Progetto:** The Foolish Butcher — foolish-storefront  
**Data:** 2026-06-04  
**Scope:** Email marketing automatizzato (Resend) + monitoring Frank

---

## Obiettivo

Costruire l'infrastruttura email completa del sito: raccolta iscritti implicita al checkout, 4 sequenze automatiche (welcome, abandoned cart, review request, re-engagement), template React Email nel brand Foolish, monitoring cron via Frank.

Escluso da questo spec: sistema recensioni (spec separata), dashboard admin visuale, broadcast editoriali (Frank via agentmail.to — nessun codice necessario).

---

## Architettura

```
Stripe webhook (acquisto completato)
    → upsert marketing.subscribers
    → Resend: welcome email (solo primo acquisto)

Checkout client (email digitata)
    → POST /api/email/cart-session
    → marketing.cart_sessions

Railway cron (ogni 15 min)
    → GET /api/cron/abandoned-cart [CRON_SECRET]
    → Resend: abandoned cart email
    → notify Frank

Railway cron (ogni ora)
    → GET /api/cron/review-request [CRON_SECRET]
    → Resend: review request email (+7gg da delivered_at)
    → notify Frank

Railway cron (lunedì 09:00)
    → GET /api/cron/reengagement [CRON_SECRET]
    → Resend: re-engagement email (inattivi 90+ giorni)
    → notify Frank

Click unsubscribe
    → GET /api/email/unsubscribe?token=<jwt>
    → marketing.subscribers status = 'unsubscribed'

Resend webhook (bounce)
    → POST /api/email/resend-webhook
    → marketing.subscribers status = 'bounced'
```

---

## Data Layer

### Schema `marketing` — Railway PostgreSQL

```sql
CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE marketing.subscribers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    locale          TEXT NOT NULL DEFAULT 'it',
    source          TEXT NOT NULL DEFAULT 'purchase',
    status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'unsubscribed', 'bounced', 'inactive')),
    purchase_count  INTEGER NOT NULL DEFAULT 0,
    total_spent     NUMERIC(10,2) NOT NULL DEFAULT 0,
    last_purchase_at TIMESTAMPTZ,
    categories      TEXT[] NOT NULL DEFAULT '{}',
    unsubscribed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscribers_status ON marketing.subscribers(status);
CREATE INDEX idx_subscribers_last_purchase ON marketing.subscribers(last_purchase_at);
CREATE INDEX idx_subscribers_email ON marketing.subscribers(email);

CREATE TABLE marketing.cart_sessions (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                TEXT,
    cart_data            JSONB NOT NULL,
    checkout_started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    email_sent_at        TIMESTAMPTZ,
    recovered_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cart_sessions_email ON marketing.cart_sessions(email);
CREATE INDEX idx_cart_sessions_pending ON marketing.cart_sessions(checkout_started_at)
    WHERE email_sent_at IS NULL AND recovered_at IS NULL;

CREATE TABLE marketing.email_log (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscriber_id  UUID REFERENCES marketing.subscribers(id),
    email          TEXT NOT NULL,
    type           TEXT NOT NULL
                   CHECK (type IN ('welcome', 'abandoned_cart', 'review_request', 'reengagement')),
    resend_id      TEXT,
    sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_log_subscriber ON marketing.email_log(subscriber_id);
CREATE INDEX idx_email_log_type ON marketing.email_log(type);
CREATE INDEX idx_email_log_sent_at ON marketing.email_log(sent_at);
```

### Modifica `foolish.orders`

```sql
ALTER TABLE foolish.orders ADD COLUMN review_email_sent_at TIMESTAMPTZ;
CREATE INDEX idx_orders_review_email ON foolish.orders(delivered_at)
    WHERE review_email_sent_at IS NULL;
```

---

## Flussi Automatici

### ① Welcome — primo acquisto

**Trigger:** Stripe webhook `checkout.session.completed` → `/api/webhook` (già esistente).

**Logica:**
1. Estrai `email`, `name`, `locale`, `amount_total`, line items dal payload Stripe.
2. `INSERT INTO marketing.subscribers ... ON CONFLICT (email) DO UPDATE SET purchase_count = purchase_count + 1, total_spent = total_spent + $amount, last_purchase_at = NOW()`.
3. Se `purchase_count` era 0 prima dell'upsert → invia welcome email via Resend.
4. Log in `marketing.email_log`.
5. Marca `marketing.cart_sessions` con `recovered_at = NOW()` per questa email (carrello recuperato).

**Timing:** immediato.

---

### ② Abandoned cart — carrello abbandonato

**Trigger client:** quando l'utente digita email nel campo checkout con ≥1 articolo in carrello → `POST /api/email/cart-session` con `{ email, cartData }`. Debounce 2 secondi sull'input email.

**Storage:** `marketing.cart_sessions` — upsert su email (una sessione aperta per email).

**Cron ogni 15 min** → `GET /api/cron/abandoned-cart`:
```sql
SELECT * FROM marketing.cart_sessions
WHERE checkout_started_at <= NOW() - INTERVAL '1 hour'
  AND email_sent_at IS NULL
  AND recovered_at IS NULL
  AND email IS NOT NULL
```
Per ogni sessione trovata:
1. Verifica che subscriber non sia `unsubscribed`/`bounced`.
2. Invia abandoned cart email via Resend.
3. Aggiorna `email_sent_at = NOW()`.
4. Log in `marketing.email_log`.
5. Notifica Frank con payload `{ cron, sent, recipients }`.

---

### ③ Review request — +7 giorni dalla consegna

**Cron ogni ora** → `GET /api/cron/review-request`:
```sql
SELECT o.*, s.status as subscriber_status
FROM foolish.orders o
LEFT JOIN marketing.subscribers s ON s.email = o.customer_email
WHERE o.delivered_at <= NOW() - INTERVAL '7 days'
  AND o.review_email_sent_at IS NULL
  AND o.customer_email IS NOT NULL
  AND (s.status IS NULL OR s.status = 'active')
```
Per ogni ordine trovato:
1. Invia review request email via Resend con `reply-to: alessandro@thefoolishbutcher.com`.
2. Aggiorna `foolish.orders.review_email_sent_at = NOW()`.
3. Log in `marketing.email_log`.
4. Notifica Frank.

**Indipendente da Frank** — Frank fa il suo follow-up Telegram a +3 giorni, questa email esce a +7 giorni.

---

### ④ Re-engagement — clienti dormienti

**Cron settimanale lunedì 09:00** → `GET /api/cron/reengagement`:
```sql
SELECT s.*
FROM marketing.subscribers s
WHERE s.status = 'active'
  AND s.last_purchase_at <= NOW() - INTERVAL '90 days'
  AND NOT EXISTS (
    SELECT 1 FROM marketing.email_log el
    WHERE el.subscriber_id = s.id
      AND el.sent_at >= NOW() - INTERVAL '30 days'
  )
LIMIT 100
```
Per ogni subscriber:
1. Invia re-engagement email via Resend.
2. Log in `marketing.email_log`.
3. Se entro 30 giorni non c'è acquisto → `status = 'inactive'` (nessuna ulteriore email).
4. Notifica Frank con summary totale run.

---

## Template Email

Costruiti con **React Email**. Struttura condivisa:

```
[Header — THE FOOLISH BUTCHER wordmark]
[Separatore oro #c8a97e]
[Body — copy di Alessandro]
[CTA button — sfondo #c8a97e, testo #080808]
[Footer — unsubscribe link · thefoolishbutcher.com]
```

**Palette email:**
- Background: `#0a0a0a`
- Testo: `#f0ede8`
- Accento: `#c8a97e`
- Muted: `#6b6560`

**4 template** in `storefront/src/emails/`:
- `welcome.tsx`
- `abandoned-cart.tsx`
- `review-request.tsx`
- `reengagement.tsx`

**Copy** in `storefront/emails/it.json` (master italiano). Il workflow è flessibile:
- Alessandro scrive il copy → Frank traduce le altre 4 lingue e committa.
- Alessandro delega a Frank → Frank scrive il copy italiano partendo dalla brand voice Foolish, Alessandro approva, Frank produce le 5 versioni e committa.
- Combinato: Alessandro detta le linee guida, Frank scrive e traduce tutto.

Ogni template riceve `locale` e carica il file JSON corrispondente.

---

## API Routes

```
POST /api/email/cart-session          # client → salva sessione carrello
GET  /api/cron/abandoned-cart         # Railway cron [CRON_SECRET]
GET  /api/cron/review-request         # Railway cron [CRON_SECRET]
GET  /api/cron/reengagement           # Railway cron [CRON_SECRET]
GET  /api/email/unsubscribe           # click unsubscribe link [JWT]
POST /api/email/resend-webhook        # Resend bounce/complaint webhook
```

Tutte le route cron verificano `Authorization: Bearer ${CRON_SECRET}` — restituzione 401 se assente.

Unsubscribe: token JWT firmato con `UNSUBSCRIBE_SECRET`, payload `{ subscriberId, email }`, expiry 30 giorni.

---

## Integrazione Frank

**Notifica post-cron:** ogni cron route, dopo l'esecuzione, POST a `FRANK_WEBHOOK_URL` con:
```json
{
  "cron": "review_request",
  "sent": 3,
  "recipients": ["mario@example.com", "luca@example.com"],
  "errors": []
}
```
Frank manda messaggio Telegram ad Alessandro. Se `errors` non è vuoto → alert prioritario.

**Frank legge solo** da `marketing.*` — writer unico è il storefront. Nessun accesso in scrittura da Frank su questo schema.

---

## File Map

```
storefront/
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── email/
│   │       │   ├── cart-session/route.ts
│   │       │   ├── unsubscribe/route.ts
│   │       │   └── resend-webhook/route.ts
│   │       └── cron/
│   │           ├── abandoned-cart/route.ts
│   │           ├── review-request/route.ts
│   │           └── reengagement/route.ts
│   ├── emails/
│   │   ├── welcome.tsx
│   │   ├── abandoned-cart.tsx
│   │   ├── review-request.tsx
│   │   └── reengagement.tsx
│   └── lib/
│       ├── marketing-db.ts       # query helpers per schema marketing
│       └── resend.ts             # Resend client + send helpers
└── emails/
    ├── it.json                   # master copy (Alessandro)
    ├── en.json                   # Frank traduce
    ├── de.json
    ├── es.json
    └── fr.json
```

---

## Environment Variables

```
RESEND_API_KEY=
RESEND_FROM=noreply@thefoolishbutcher.com
RESEND_WEBHOOK_SECRET=
CRON_SECRET=
UNSUBSCRIBE_SECRET=
FRANK_WEBHOOK_URL=
```

---

## Compliance GDPR

- Opt-in implicito legittimo per clienti esistenti (Recital 47 GDPR).
- Unsubscribe obbligatorio in ogni email — effetto immediato, nessuna conferma richiesta.
- Bounce hard → `status = 'bounced'` automatico via Resend webhook.
- Nessun subscriber `unsubscribed`/`bounced`/`inactive` riceve email — filtro su ogni cron.
- Dati conservati in Railway EU — compliant con requisiti di residenza dati.
