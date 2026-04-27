# Foolish Business Line — nanobot

Technical brief for Claude Code.
Owner: Alessandro (The Foolish Butcher).
Parent project: nanobot (HKUDS/nanobot fork).
Status: greenfield, builds on top of existing `BusinessContext` + Mem0 + pgvector architecture.

---

## Stato implementazione — 2026-04-25

**Completato (in produzione su Railway):**
- Schema DB `foolish.*` (orders, sheets, messages, order_sheets)
- WooCommerce webhook → alert Alessandro + ETA button inline
- Sheet registration conversazionale (`foolish_register_sheet`, `foolish_query_sheets`)
- Matching proposta + approve/reject (`foolish_propose_matching`)
- Shipment registration + tracking cliente (`foolish_register_shipment`)
- Packlink Pro: risolve carrier reale al momento della spedizione; polling ogni 6h per stato consegna
- Photo upload Cloudflare R2 + forward automatico al cliente
- Deep link customer onboarding (`/start order_<id>`)
- Session isolation multi-bot — bug fix critico: sessioni separate per canale Telegram

**Non ancora costruito (priorità da definire con Alessandro):**
- Voice note support (trascrizione Whisper per registrazione fogli)
- FSM validation esplicita con `InvalidStateTransition`
- Trust-threshold approval logic automatica (30 giorni → auto-send)
- `tech_suggestion` nel preview basato su memoria cliente Mem0
- Risposta cliente inbound → Mem0 + flag Alessandro su "problema"
- ETA custom da testo libero (ora serve numero esatto)

**Prossimo step:** Alessandro testa in produzione e definisce cosa costruire.

---

## 1. Purpose

Add a new business line `foolish` to nanobot that orchestrates the full pre-sale → production → shipment → post-sale lifecycle for The Foolish Butcher (artisanal synthetic tattoo-practice skin).

The core insight: every sheet Alessandro produces is physically unique (hand-flocked silicone, irrepeatable texture/discoloration). The system must preserve and communicate this uniqueness end-to-end, transforming "slow artisanal shipping" into "curated delivery of a product made for you specifically".

---

## 2. Scope of this brief

This brief covers **Phase 1 only**: the order-to-delivery pipeline. It explicitly does not cover (will be separate briefs):

- Daily drop editorial system (content atomization across IG / Telegram channel / WhatsApp)
- Art Director agent (photography coaching / knowledge base)
- Subscriber-facing PWA
- WooCommerce headless migration

Keep all Phase 1 code behind a clean module boundary so future phases can extend without refactor.

---

## 3. High-level pipeline

```
[WooCommerce order created]
        |
        v
[nanobot receives webhook]
        |
        v
[Telegram alert to Alessandro with order context]
        |
  (Alessandro replies with production ETA)
        |
        v
[nanobot sends pre-production message to customer via Telegram bot]
        |
  (production happens — sheets are registered to DB as they are produced
   via conversational ingest with nanobot, separate sub-flow)
        |
        v
[nanobot proposes sheet-to-order matching to Alessandro]
        |
  (Alessandro confirms or adjusts allocation)
        |
        v
[nanobot composes pre-shipment preview for customer:
   photos of actual sheets + flock/discoloration notes]
        |
  (Alessandro approves during first month,
   then system auto-sends after trust threshold)
        |
        v
[Alessandro ships via Packlink Pro, registers tracking in system]
        |
        v
[nanobot sends tracking message to customer]
        |
        v
[Packlink webhook "delivered" → schedule follow-up +3 days]
        |
        v
[nanobot sends post-delivery check-in, stores response to customer memory]
```

---

## 4. Stack decisions (locked for Phase 1)

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Python 3.11+, FastAPI | Same as Studio Penale AI |
| Orchestration | LangGraph | Sub-graph per pipeline stage |
| LLM routing | LiteLLM | Reuse existing config |
| Database | Postgres on Railway EU | Self-hosted, no Airtable |
| Vector store | pgvector | Co-located with Postgres |
| Long-term memory | Mem0 | Already wired in nanobot core |
| Customer channel | Telegram bot (single bot, business-line scoped) | No WhatsApp in Phase 1 |
| Internal channel (Alessandro) | Telegram private chat to bot | Same bot, different chat_id |
| Order source | WooCommerce REST API + webhooks | On existing WordPress |
| Shipping | Packlink Pro API + webhooks | For tracking + delivery status |
| Deployment | Railway EU (same cluster as nanobot) | New service `nanobot-foolish` |
| Secrets | Railway env vars | No secrets in repo |

---

## 5. Domain model

### 5.1 Postgres schema

All tables live in schema `foolish`. Prefix every table with business-line context even though the schema already scopes it — makes cross-business joins explicit later.

```sql
CREATE SCHEMA IF NOT EXISTS foolish;

-- Master catalog of physical sheets produced
CREATE TABLE foolish.sheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    serial_code TEXT UNIQUE NOT NULL,           -- e.g. 'F25-A5-042'
    produced_at DATE NOT NULL,
    format TEXT NOT NULL,                       -- 'A5' | 'A4' | 'XXL' | 'AlexHand' | etc.
    sku_ref TEXT,                               -- optional link to WooCommerce product SKU
    flock_density TEXT CHECK (flock_density IN ('low','medium','high')),
    flock_color_notes TEXT,                     -- free text description of unique features
    status TEXT NOT NULL DEFAULT 'in_stock'     -- 'in_stock' | 'reserved' | 'shipped' | 'defective'
        CHECK (status IN ('in_stock','reserved','shipped','defective')),
    photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],  -- object storage URLs for color-accurate photos
    reserved_for_order_id BIGINT,               -- WooCommerce order id when status='reserved'
    shipped_in_order_id BIGINT,                 -- WooCommerce order id when status='shipped'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sheets_status ON foolish.sheets(status);
CREATE INDEX idx_sheets_format ON foolish.sheets(format);
CREATE INDEX idx_sheets_reserved ON foolish.sheets(reserved_for_order_id);

-- Orders mirror from WooCommerce, with pipeline state
CREATE TABLE foolish.orders (
    id BIGINT PRIMARY KEY,                      -- WooCommerce order id
    customer_email TEXT NOT NULL,
    customer_name TEXT,
    customer_telegram_id BIGINT,                -- linked on first customer interaction
    line_items JSONB NOT NULL,                  -- raw from WooCommerce
    total NUMERIC(10,2),
    currency TEXT DEFAULT 'EUR',
    pipeline_state TEXT NOT NULL DEFAULT 'received'
        CHECK (pipeline_state IN (
            'received',              -- webhook arrived, pending triage
            'eta_pending',           -- waiting for Alessandro's ETA reply
            'eta_confirmed',         -- customer received pre-production message
            'in_production',         -- sheets being made
            'matching_pending',      -- system proposed matching, waiting approval
            'matched',               -- sheets allocated, pre-shipment preview composed
            'preview_sent',          -- customer received preview
            'shipped',               -- tracking registered
            'delivered',             -- Packlink confirmed delivery
            'followup_done',         -- post-delivery check-in sent
            'closed'
        )),
    production_eta_days INTEGER,                -- set by Alessandro
    tracking_number TEXT,
    tracking_carrier TEXT,
    shipped_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    followup_scheduled_at TIMESTAMPTZ,
    followup_sent_at TIMESTAMPTZ,
    raw_webhook JSONB,                          -- full WooCommerce payload for audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_state ON foolish.orders(pipeline_state);
CREATE INDEX idx_orders_customer_email ON foolish.orders(customer_email);
CREATE INDEX idx_orders_followup ON foolish.orders(followup_scheduled_at)
    WHERE followup_sent_at IS NULL;

-- Messages sent/received (audit + debugging + future ML training)
CREATE TABLE foolish.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id BIGINT REFERENCES foolish.orders(id),
    direction TEXT NOT NULL CHECK (direction IN ('outbound','inbound')),
    channel TEXT NOT NULL DEFAULT 'telegram',
    recipient TEXT,                             -- telegram chat_id or email
    stage TEXT NOT NULL,                        -- 'pre_production' | 'preview' | 'tracking' | 'followup' | etc.
    body TEXT NOT NULL,
    media_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
    approved_by_alessandro BOOLEAN DEFAULT NULL, -- null=not required, true/false=reviewed
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_order ON foolish.messages(order_id);
CREATE INDEX idx_messages_approval ON foolish.messages(approved_by_alessandro)
    WHERE approved_by_alessandro IS NULL AND sent_at IS NULL;

-- Order-to-sheet allocation (many-to-many)
CREATE TABLE foolish.order_sheets (
    order_id BIGINT NOT NULL REFERENCES foolish.orders(id),
    sheet_id UUID NOT NULL REFERENCES foolish.sheets(id),
    allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (order_id, sheet_id)
);
```

Add the standard `updated_at` trigger on `sheets` and `orders` (use the existing nanobot utility function if present, otherwise create `foolish.touch_updated_at()`).

### 5.2 Mem0 namespaces

Under the `foolish` business line, use these memory namespaces:

- `foolish:customer:{email}` — long-term facts about each customer (tatuatore style, preferences expressed, past feedback, tone calibration)
- `foolish:production` — production-side knowledge (which flock densities sell best, seasonal patterns, Alessandro's evolving techniques)
- `foolish:editorial` — reserved for Phase 2 (daily drop agent)

Customer messages (inbound) feed `foolish:customer:{email}` automatically. Alessandro's ad-hoc notes to nanobot about a customer also go there.

---

## 6. Module layout

```
nanobot/
├── business_lines/
│   ├── __init__.py
│   ├── base.py                       # existing BusinessContext, do not modify
│   └── foolish/
│       ├── __init__.py
│       ├── context.py                # FoolishContext(BusinessContext)
│       ├── config.py                 # env-driven config (Telegram tokens, Woo URL, Packlink key)
│       ├── models.py                 # Pydantic models for sheets, orders, messages
│       ├── db.py                     # asyncpg pool, repository classes
│       ├── mem.py                    # Mem0 helpers scoped to foolish namespaces
│       ├── graphs/
│       │   ├── __init__.py
│       │   ├── order_received.py     # sub-graph: new order → Alessandro alert → ETA capture
│       │   ├── customer_notify.py    # sub-graph: send pre-production + preview + tracking
│       │   ├── matching.py           # sub-graph: propose sheet allocation
│       │   ├── shipment.py           # sub-graph: tracking registration + delivery tracking
│       │   └── followup.py           # sub-graph: post-delivery check-in
│       ├── tools/
│       │   ├── __init__.py
│       │   ├── sheets.py             # register_sheet, query_sheets, update_sheet_status
│       │   ├── orders.py             # get_order, update_pipeline_state, set_eta
│       │   ├── telegram.py           # send_to_customer, send_to_alessandro, wait_for_reply
│       │   ├── woocommerce.py        # get_order_details (fallback if webhook missed data)
│       │   └── packlink.py           # register_tracking, get_shipment_status
│       ├── templates/
│       │   ├── __init__.py
│       │   └── messages.py           # Jinja2 templates with Foolish tone-of-voice
│       ├── api/
│       │   ├── __init__.py
│       │   ├── webhooks.py           # FastAPI routes: /hooks/woocommerce, /hooks/packlink
│       │   ├── telegram.py           # FastAPI route: /hooks/telegram
│       │   └── admin.py              # simple endpoints for manual ops
│       └── scheduler.py              # APScheduler jobs (followup dispatcher, retry logic)
├── tests/
│   └── foolish/
│       ├── test_order_received.py
│       ├── test_matching.py
│       ├── test_customer_notify.py
│       └── test_followup.py
└── scripts/
    └── foolish/
        ├── migrate.py                # apply SQL schema
        └── seed_dev.py               # seed dev DB with fake sheets + orders
```

---

## 7. Tools (LangGraph)

All tools are async, use asyncpg pool from `FoolishContext`, return Pydantic models. Standard error handling: log + raise custom `FoolishToolError` that the graph can catch for retry/fallback.

### 7.1 Sheet tools

- `register_sheet(serial_code, produced_at, format, flock_density, flock_color_notes, sku_ref=None, photo_urls=[])` → `Sheet`
  Called from conversational ingest. Validates serial_code uniqueness. Returns created row.

- `query_sheets(status=None, format=None, min_count=None)` → `list[Sheet]`
  Used by matching graph. Supports filter composition.

- `update_sheet_status(sheet_id, status, order_id=None)` → `Sheet`
  Transactional. When moving to `reserved`, sets `reserved_for_order_id`. When moving to `shipped`, moves to `shipped_in_order_id` and clears reservation.

- `attach_photos(sheet_id, photo_urls)` → `Sheet`
  Appends to existing array.

### 7.2 Order tools

- `get_order(order_id)` → `Order`
- `update_pipeline_state(order_id, new_state, metadata={})` → `Order`
  Validates state transitions against an explicit FSM map (see §9).
- `set_production_eta(order_id, days)` → `Order`
- `register_tracking(order_id, tracking_number, carrier)` → `Order`
  Also triggers `customer_notify` graph with stage='tracking'.

### 7.3 Telegram tools

- `send_to_customer(order_id, stage, body, media_urls=[], require_approval=None)` → `Message`
  If `require_approval=True` (or Alessandro hasn't passed the trust threshold), stores in `messages` with `approved_by_alessandro=None` and sends Alessandro a preview with inline approve/edit/reject buttons. Only after approval does the message actually send.
  Default `require_approval` logic: `True` for first 30 days of operation OR for stages `preview` and `followup`. `False` for `tracking` (low-stakes, templated).

- `send_to_alessandro(text, buttons=None)` → `Message`
  Direct channel to Alessandro's chat_id. Used for alerts, approvals, matching proposals.

- `handle_telegram_update(update)` → `None`
  Router for incoming Telegram messages. Dispatches:
  - Messages from Alessandro's chat_id → intent classifier (reply to approval, register sheet conversationally, set ETA, etc.)
  - Messages from customer chat_ids → store in `messages` table, feed Mem0, pass to customer response graph (simple for Phase 1: acknowledge + flag Alessandro if keywords like "problema"/"reso"/"ritardo")

### 7.4 Packlink tools

- `register_tracking_with_packlink(order_id, tracking_number)` → `dict`
  POSTs to Packlink API to enable status webhooks for this shipment.
- `get_shipment_status(tracking_number)` → `dict`
  Fallback poll in case webhook misses.

### 7.5 WooCommerce tool

- `get_order_details(order_id)` → `dict`
  REST call to WooCommerce. Used when the webhook payload is insufficient or for reconciliation.

---

## 8. Graphs (LangGraph sub-graphs)

Every sub-graph has a single entry state, explicit transitions, and a terminal state. Graphs are composable — the root `foolish_pipeline` graph routes based on incoming event type.

### 8.1 `order_received`

Entry: WooCommerce webhook payload.
Steps:
1. Validate + upsert into `foolish.orders` with state `received`
2. Enrich: lookup customer in Mem0 (`foolish:customer:{email}`) for past context
3. Compose Alessandro alert (order summary + customer history + prompt for ETA)
4. Send to Alessandro via Telegram with ETA input button
5. Transition to `eta_pending`
6. When ETA reply arrives (handled by telegram router): set ETA, compose pre-production message, send to customer with `require_approval` logic, transition to `eta_confirmed`

### 8.2 `matching`

Entry: trigger from Alessandro ("matcha ordine X") or scheduled check when `in_production` orders have available stock.
Steps:
1. Load order + line items
2. Query available sheets matching each line item (by format + optional SKU ref)
3. Compose matching proposal: which specific sheets for this specific customer
   - Use Mem0 customer memory to bias selection (e.g. past preference for denser flock → propose those)
4. Send to Alessandro with approve/adjust buttons
5. On approval: mark sheets `reserved`, insert `order_sheets` rows, transition order to `matched`
6. Trigger `customer_notify` with stage='preview'

### 8.3 `customer_notify`

Entry: stage ('pre_production' | 'preview' | 'tracking' | 'followup') + order_id.
Steps:
1. Load order, customer memory, relevant sheets
2. Select template from `templates/messages.py`
3. LLM-render template with context (Foolish tone-of-voice baked into system prompt)
4. Call `send_to_customer` with appropriate `require_approval` flag
5. Update order state on success

### 8.4 `shipment`

Entry: Alessandro reports "spedito ordine X, tracking Y".
Steps:
1. Validate order is in `preview_sent` state
2. Call `register_tracking` + `register_tracking_with_packlink`
3. Mark allocated sheets as `shipped`
4. Trigger `customer_notify` stage='tracking'
5. Transition order to `shipped`

### 8.5 `followup`

Entry: scheduler cron (every 15 min) checking `followup_scheduled_at <= NOW() AND followup_sent_at IS NULL`.
Scheduling rule: set `followup_scheduled_at = delivered_at + INTERVAL '3 days'` when Packlink webhook reports delivery.
Steps:
1. Load order + delivered_at + customer memory
2. Compose check-in message ("come è arrivato il pacco? hai già provato X?")
3. Call `send_to_customer` with `require_approval=True` in trust period
4. On send: set `followup_sent_at`, transition to `followup_done`

---

## 9. State machine (explicit, tested)

Valid transitions for `orders.pipeline_state`:

```
received → eta_pending
eta_pending → eta_confirmed | received (retry on bad ETA)
eta_confirmed → in_production
in_production → matching_pending
matching_pending → matched | in_production (rejected, produce more)
matched → preview_sent
preview_sent → shipped
shipped → delivered
delivered → followup_done
followup_done → closed
```

Any other transition raises `InvalidStateTransition`. Keep the FSM map as a module-level constant in `db.py`.

---

## 10. Message templates

All customer-facing messages use Jinja2 templates with a shared system prompt that encodes the Foolish tone-of-voice. Tone reference (from the website manifesto):

- Direct, no corporate fluff
- Artisanal pride without pretension
- Technical respect for the tatuatore's craft
- Italian primary, natural code-switching to English for technical terms (flock, skin, linework) is fine
- Never over-explain, never apologize preemptively

### 10.1 Template: pre-production

```
Ciao {{ customer_first_name }},

Ordine ricevuto. {% if returning_customer %}Bentornato.{% endif %}

Sto producendo personalmente quello che hai ordinato. Tempo stimato: {{ eta_days }} giorni.

Quando i fogli sono pronti ti scrivo con le foto di cosa ti arriva, così sai esattamente cosa ti sto spedendo — non due fogli identici escono dalla mia produzione.

Alessandro
```

### 10.2 Template: pre-shipment preview

```
{{ customer_first_name }}, ecco cosa ti sto per spedire.

{% for sheet in sheets %}
— {{ sheet.format }} (serie {{ sheet.serial_code }}):
  {{ sheet.flock_color_notes }}
{% endfor %}

{% if tech_suggestion %}{{ tech_suggestion }}{% endif %}

Domani parte. Ti mando il tracking appena è in viaggio.
```

`tech_suggestion` is optionally populated by the matching graph based on customer memory (e.g. "sull'A4 con flock denso al centro prova linework fine, rende meglio").

### 10.3 Template: tracking

```
Partito. Tracking: {{ tracking_number }} ({{ carrier }}).
Link: {{ tracking_url }}

Fammi sapere quando arriva.
```

### 10.4 Template: post-delivery follow-up

```
{{ customer_first_name }}, il pacco dovrebbe essere arrivato qualche giorno fa.

Tutto ok? Hai già provato a tatuarci qualcosa?

Mi interessa davvero — ogni feedback mi serve per il prossimo lotto.
```

Keep templates minimal and editable. Alessandro iterates these from the admin UI in Phase 2.

---

## 11. Conversational sheet ingest (critical UX path)

This is the single most important interaction for daily operation. Alessandro talks to nanobot (voice note or text on Telegram) to register a sheet just made. The tool must handle imprecise natural-language input.

Example inputs that must work:
- "ho appena finito un A4, lotto di oggi, flock denso al centro con discromia ocra angolo destro, seriale 042"
- "due A5 DuoSkin, flock medio uniforme"
- "XXL, flock basso, quasi pulito, solo una linea scura diagonale"

Implementation:
1. Router in `handle_telegram_update` detects registration intent (keywords + LLM intent classifier)
2. Pass to dedicated LangGraph node `extract_sheet_fields` with a tight Pydantic schema as output format
3. Confirm extraction with Alessandro: "ho capito: A4, 2025-11-17, flock high, 'discromia ocra angolo destro', seriale F25-A4-042. Confermi?"
4. On confirmation: call `register_sheet` tool
5. Prompt for photo upload: "mandami le foto appena le hai"
6. On photo receipt: upload to object storage (Railway volume or S3-compatible), call `attach_photos`

Serial code auto-generation if not provided: format `F{YY}-{FORMAT}-{NNN}` where NNN is monotonic per (year, format) from `MAX(serial_code)` query.

Voice note support: use LiteLLM to route transcription to Whisper or Gemini Flash depending on cost/latency preference (start with Whisper).

---

## 12. Webhooks

### 12.1 WooCommerce

Endpoint: `POST /hooks/woocommerce`
Security: verify `X-WC-Webhook-Signature` header (HMAC SHA256 with shared secret from env).
Events to subscribe: `order.created`, `order.updated`.
Handler: parse payload → call `order_received` graph (new) or update existing order (status changes from Woo side).

Register the webhook in WooCommerce admin manually on first deployment. Document the URL + secret in README-ops.md (which you should create alongside code).

### 12.2 Packlink

Endpoint: `POST /hooks/packlink`
Security: verify Packlink signature (check current Packlink API docs for mechanism; if HMAC not available, fall back to IP allowlist).
Events to handle: shipment state changes, especially `DELIVERED`.
Handler: find order by tracking number, set `delivered_at = NOW()`, schedule followup.

### 12.3 Telegram

Endpoint: `POST /hooks/telegram`
Security: verify `X-Telegram-Bot-Api-Secret-Token` header against env secret.
Handler: `handle_telegram_update` router (§7.3).

---

## 13. Customer-to-Telegram linking

First time a customer interacts with the bot, they won't be linked to their WooCommerce email. Flow:

1. Pre-production message is sent to Alessandro first (trust period) → Alessandro forwards it or pastes a Telegram deep link (`t.me/foolishbot?start=order_{id}`) into the customer's email confirmation via WooCommerce email hook (future phase: automatic).
2. Customer clicks deep link → bot receives `/start order_{id}` → bot asks for email confirmation → bot stores `customer_telegram_id` in `foolish.orders`.
3. All future messages for that customer go to Telegram directly.

Fallback for customers who never link: send via email (not implemented in Phase 1 — flag for Phase 2).

For Phase 1, to keep things simple, start with manual linking: Alessandro gives the bot the customer's Telegram handle when he knows it, via a command `/link order_id telegram_username`.

---

## 14. Trust-threshold approval logic

First 30 days of Phase 1 operation:
- ALL customer-facing messages require Alessandro approval before sending.
- Approval UI: Telegram message to Alessandro with full draft + buttons `[Invia ✓] [Modifica ✏️] [Annulla ✗]`.
- Modifica: Alessandro replies with corrected text in next Telegram message.

After 30 days, configurable per-stage:
- `pre_production`, `preview`, `followup` → approval still required (touches customer sensitively)
- `tracking` → auto-send (templated, low-variance)

Store the trust-threshold crossing date in config (env var or DB config table). Do not flip automatically — Alessandro must explicitly relax each stage.

---

## 15. Testing

Minimum test coverage for Phase 1 merge:

- Unit tests for all tools (mocked DB + HTTP)
- Integration tests per graph with a test Postgres (testcontainers) and mocked external APIs
- End-to-end test: fake WooCommerce webhook → verify Telegram mock receives Alessandro alert → simulate ETA reply → verify customer Telegram mock receives pre-production → step through matching → verify preview message composition → simulate Packlink delivery webhook → verify followup scheduled

Follow the testing patterns already established in Studio Penale AI (pytest + pytest-asyncio + testcontainers).

---

## 16. Environment variables

```
# Database
FOOLISH_DATABASE_URL=postgresql+asyncpg://...

# Telegram
FOOLISH_TELEGRAM_BOT_TOKEN=
FOOLISH_TELEGRAM_WEBHOOK_SECRET=
FOOLISH_ALESSANDRO_CHAT_ID=

# WooCommerce
FOOLISH_WOO_BASE_URL=https://thefoolishbutcher.com
FOOLISH_WOO_CONSUMER_KEY=
FOOLISH_WOO_CONSUMER_SECRET=
FOOLISH_WOO_WEBHOOK_SECRET=

# Packlink
FOOLISH_PACKLINK_API_KEY=
FOOLISH_PACKLINK_WEBHOOK_SECRET=

# LLM routing (reuse nanobot-level config)
# LITELLM_* — inherited

# Object storage for sheet photos
FOOLISH_OBJECT_STORAGE_BUCKET=
FOOLISH_OBJECT_STORAGE_ENDPOINT=
FOOLISH_OBJECT_STORAGE_KEY=
FOOLISH_OBJECT_STORAGE_SECRET=

# Operational
FOOLISH_TRUST_THRESHOLD_DATE=2026-05-23   # 30 days after launch
FOOLISH_FOLLOWUP_DELAY_DAYS=3
```

---

## 17. Deployment

Single Railway service `nanobot-foolish` in the EU cluster.
- Dockerfile inherits from nanobot base
- Run `scripts/foolish/migrate.py` on deploy via Railway deploy command
- Exposes FastAPI on port from `$PORT`
- APScheduler runs in-process (single-instance deployment for Phase 1)

Add health endpoint `GET /health/foolish` that checks: DB connection, Telegram bot reachability, WooCommerce API reachability, Packlink API reachability.

---

## 18. Out of scope for Phase 1 (do not build)

- WhatsApp integration
- Email fallback
- Multi-language (assume IT customers; English customers get same IT messages for now)
- PWA / customer-facing web UI
- Automated daily drop
- Art director photography suggestions
- Multi-instance scheduler (single-instance is fine at current volume)
- Self-healing retry across long outages (basic retry is enough)
- Admin dashboard (Alessandro operates via Telegram only)

---

## 19. First milestone: "hello order"

The smallest end-to-end slice that proves the architecture:

1. Schema migrated in Railway EU dev database
2. Telegram bot online, responds to `/start` from Alessandro's chat_id
3. WooCommerce webhook endpoint receives test payload (use Woo's "test webhook" feature)
4. On webhook: order row created, Alessandro receives Telegram alert with order summary + ETA button
5. Alessandro replies with ETA; customer (simulated, Alessandro's own Telegram) receives pre-production message after approval
6. State machine advances correctly

Do NOT build matching, shipment, or followup until step 6 is green. One slice at a time.

---

## 20. Open decisions (flag to Alessandro before building)

These require Alessandro's input during the build:

- Exact WooCommerce webhook URL + secret generation
- Packlink API credentials + webhook registration (requires login to Packlink Pro dashboard)
- Telegram bot creation (via BotFather) and bot username choice
- Object storage: Railway volume vs external S3 (e.g. Backblaze B2 EU)
- Serial code format confirmation (`F25-A5-042` is a proposal — Alessandro may have his own numbering already)
- Initial set of sheet formats to whitelist in the `format` enum

Ask each question as it becomes relevant in Claude Code session, do not block on all of them upfront.

---

## 21. Style guide

- Type hints everywhere, Pydantic for all I/O boundaries
- Async throughout (asyncpg, httpx, python-telegram-bot async API)
- Logging: structlog, one log line per graph transition with order_id as key
- No print statements
- Docstrings in English, user-facing strings (templates) in Italian
- Error messages in logs: English. Error messages to Alessandro via Telegram: Italian
- No abbreviations in variable names except well-known (url, id, db)
- Test files mirror source tree 1:1

---

## 22. Reference: Alessandro's operational constraints

- Solo artisan, production hands-dirty
- Minutes available per day for system interaction, not hours
- Prefers voice/chat interaction over forms
- Italian native, English for technical terms
- Full time on Foolish
- Burn-the-boats commitment style — once started, no reverse
- Values clean architecture, self-hosted when reasonable, Railway EU ecosystem

Every code decision should reduce Alessandro's friction in production. If a feature adds friction, it's wrong — even if it's technically cleaner.
