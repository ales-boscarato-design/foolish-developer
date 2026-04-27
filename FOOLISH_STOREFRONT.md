# Foolish Butcher — Smart Storefront
## Brief tecnico Phase 2

Owner: Alessandro Boscarato (The Foolish Butcher)
Status: draft — approvato verbalmente, da buildare
Data: 2026-04-25

---

## 0. Obiettivo

Sostituire WordPress/WooCommerce con una vetrina moderna, gestibile senza competenze tecniche.
Due canali di gestione equivalenti: pannello admin web (accesso diretto emergenze) + Telegram via nanobot (operatività quotidiana).
Comunicazione post-acquisto su Telegram. WooCommerce resta accessibile ma non viene più toccato.

---

## 1. Architettura

```
Payload CMS (Railway EU)
  - pannello admin: admin.thefoolishbutcher.com
  - API REST/GraphQL per prodotti, ordini, clienti, media
       ↑ ↓
Nanobot (Railway EU — già live)
  - legge/scrive via Payload API
  - gestione prodotti via Telegram (stessi permessi admin)
  - notifiche cliente su Telegram
  - WhatsApp Phase 3
       ↓
Next.js storefront (Railway EU)
  - vetrina pubblica: thefoolishbutcher.com (nuovo)
  - SSR + ISR per performance
  - Revolut embedded checkout
       ↓ webhook ORDER_COMPLETED
Nanobot → Telegram cliente
       ↓
Postgres foolish.* (già su Railway EU)
  - ordini, clienti, sessioni (già parzialmente strutturato Phase 1)
```

---

## 2. Prodotti

### Sezione TATTOO

#### T-Sheet Skin DBL
Fogli di pelle sintetica con due facciate differenti: 1 color pelle, 1 bianca.
Produzione artigianale giornaliera — ogni foglio è unico per colore, sfumatura e nuance.
**Headline copy:** "Non avrai mai due ordini con la stessa pelle. Esattamente come la pelle dei tuoi clienti."

| Variante | Dimensioni | Spessore | Prezzo |
|----------|-----------|---------|--------|
| A5       | 20×15 cm  | 4 mm    | 15,00€ |
| A4       | 30×20 cm  | 4 mm    | 28,00€ |
| L        | 60×40 cm  | 4 mm    | 50,00€ |
| XXL      | 80×60 cm  | 4 mm    | 69,95€ |
| Rotolo   | 180×60 cm | 4 mm    | 150,00€ |

#### T-Sheet Skin DUOSKIN
Fogli di pelle sintetica con due facciate uguali per consistenza, colorazione e texture.

| Variante     | Dimensioni | Spessore | Prezzo |
|-------------|-----------|---------|--------|
| A5 — Pelle  | 20×15 cm  | 8 mm    | 24,00€ |
| A5 — Bianco | 20×15 cm  | 8 mm    | 24,00€ |
| A4 — Pelle  | 30×20 cm  | 8 mm    | 38,00€ |
| A4 — Bianco | 30×20 cm  | 8 mm    | 38,00€ |
| A3 — Pelle  | 40×30 cm  | 6 mm    | 50,00€ |
| A3 — Bianco | 40×30 cm  | 6 mm    | 50,00€ |

#### Mano Iperrealistica per Tattoo
Prodotto singolo, no varianti. Prezzo: **45,00€**

---

### Sezione PMU (Permanent Make-up)

#### Kit Viso Iperrealistico per pratica PMU
Prodotto singolo. Prezzo: **75,00€**

#### Sostegno da tavolo per kit viso tridimensionale
Accessorio. Prezzo: **15,00€**

#### Supporto Viso tridimensionale in resina verniciato a mano
Prodotto singolo. Prezzo: **45,00€**

#### Viso Iperrealistico per pratica trucco permanente
Prodotto singolo. Prezzo: **25,00€**

---

## 3. Stack tecnico (locked)

| Componente | Scelta | Note |
|-----------|--------|------|
| CMS / Admin | Payload CMS 2.x | Self-hosted Railway, TypeScript |
| Storefront | Next.js 14+ (App Router) | SSR + ISR, Railway |
| Database CMS | Postgres Railway (schema `foolish_cms`) | Separato da `foolish.*` ordini |
| Pagamenti | Revolut Merchant API + widget JS | Webhook HMAC SHA-256 |
| Media | Cloudflare R2 | Già usato per foto fogli |
| Comunicazioni | Telegram (nanobot già live) | WhatsApp Phase 3 |
| Deploy | Railway EU | Tutto nello stesso cluster |
| DNS | Cloudflare | Già presente |

---

## 4. Payload CMS — collections

```
products
  - slug (unique)
  - name
  - section: 'tattoo' | 'pmu'
  - description (rich text)
  - unique_note (testo artigianalità — solo DBL)
  - variants: array
      - label (es. "A4", "A5 — Pelle")
      - sku
      - price (float)
      - dimensions (text)
      - thickness_mm (int)
      - stock_status: 'available' | 'low' | 'unavailable'
  - images: array (Cloudflare R2)
  - active (boolean)
  - order (int, per sorting)

orders
  - (mirror di foolish.orders già esistente — Payload legge/scrive, nanobot legge/scrive)
  - source: 'storefront'
  - revolut_order_id
  - revolut_status
  - customer_telegram_id
  - pipeline_state (FSM Phase 1 già definita)

customers
  - email (unique)
  - name
  - telegram_id
  - telegram_username
  - preferred_channel: 'telegram' | 'email'
  - notes (Alessandro scrive qui via Telegram)
  - mem0_namespace: 'foolish:customer:{email}'
```

---

## 5. Storefront — pagine

```
/                    → hero + due sezioni Tattoo / PMU + sezione "Stock Limitato" (se popolata)
/tattoo              → griglia prodotti sezione tattoo
/pmu                 → griglia prodotti sezione pmu
/limited             → stock limitato — colorazioni rare, visibile solo se ci sono prodotti attivi
/prodotto/[slug]     → pagina prodotto con varianti + checkout Revolut
/ordine/[id]         → stato ordine (link in messaggio Telegram al cliente)
/grazie              → post-pagamento (prima comunicazione Telegram parte da qui)
```

Design: minimal, dark o neutro, foto prodotto dominante, copy diretto stile brand Foolish.
Mobile-first — la maggior parte dei tatuatori compra da telefono.

### Sezione "Stock Limitato"
- Non sempre visibile: compare in homepage e nel nav solo se ci sono prodotti con `limited_stock: true`
- Prodotti che entrano qui: colorazioni rare o lotti speciali — Alessandro li attiva da Telegram o da Payload admin
- Visual urgency: badge "LIMITATO", countdown opzionale, quantità residua
- Comando Telegram: `/limita [sku] [quantità]` → attiva badge e sposta in sezione limitata

---

## 6. Checkout flow

```
Cliente sceglie variante
        ↓
"Aggiungi al carrello" → mini cart laterale
        ↓
Checkout: nome, email, indirizzo spedizione
        ↓
Revolut embedded checkout (widget JS)
  - carta, Apple Pay, Google Pay, Revolut Pay
        ↓
ORDER_COMPLETED webhook → nanobot
        ↓
nanobot:
  1. crea/aggiorna record foolish.orders
  2. cerca cliente in foolish.customers
  3. se cliente ha telegram_id → messaggio Telegram immediato
  4. se non ha telegram_id → salva email, invia link Telegram onboarding
  5. Alessandro riceve alert su Telegram (pipeline Phase 1 già live)
```

---

## 7. Gestione prodotti via Telegram (nanobot)

Comandi che Alessandro può dare al bot Foolish su Telegram:

```
/prodotti               → lista tutti i prodotti con stato stock
/prodotto [slug]        → dettaglio + varianti + prezzi
/aggiorna prezzo [sku] [prezzo]
/aggiorna stock [sku] [available|low|unavailable]
/aggiungi prodotto      → flow conversazionale guidato
/disattiva [slug]       → nasconde dalla vetrina
/ordini                 → ultimi 10 ordini con stato
/ordine [id]            → dettaglio ordine
/cliente [email]        → profilo cliente + storico
/nota [email] [testo]   → aggiunge nota al cliente
```

Stesso effetto di operare direttamente nel pannello Payload — entrambi scrivono sullo stesso Postgres.

---

## 8. Nanobot tools nuovi (Phase 2)

Da aggiungere a `nanobot/agent/tools/`:

- `foolish_get_products` — lista prodotti da Payload API
- `foolish_update_product` — aggiorna prezzo, stock, testo
- `foolish_create_product` — crea nuovo prodotto con varianti
- `foolish_deactivate_product` — nascondi dalla vetrina
- `foolish_get_storefront_orders` — ordini da storefront (distinti da WooCommerce)
- `foolish_link_customer_telegram` — collega email cliente a telegram_id

---

## 9. Comunicazione cliente — flow Telegram

### Primo acquisto (cliente senza Telegram collegato)
```
Ordine confermato → email automatica Revolut (ricevuta pagamento)
        +
Nanobot invia link onboarding:
"Ciao, sono Alessandro di The Foolish Butcher.
Ho ricevuto il tuo ordine #X.
Se vuoi ricevere aggiornamenti diretti su Telegram, clicca qui: t.me/foolishbot?start=order_X"
```

### Cliente con Telegram collegato
```
Ordine confermato → Telegram immediato:
"Ordine ricevuto. Sto producendo i tuoi fogli.
Ti scrivo quando sono pronti con le foto di quello che ti spedisco."
        ↓
Produzione completata → preview foto (Phase 1 già funziona)
        ↓
Spedito → tracking
        ↓
Consegnato +3gg → follow-up
```

---

## 10. Onboarding progressivo su Telegram

Obiettivo: spostare tutti i clienti da email a Telegram nel tempo.

Meccanismi:
- Link onboarding in ogni email post-acquisto
- Footer storefront: "Seguici su Telegram per aggiornamenti ordine in tempo reale"
- Pagina /grazie: CTA primaria "Ricevi aggiornamenti su Telegram"
- Follow-up 30gg post-acquisto: "Hai Telegram? Ti avviso in anticipo quando escono nuove colorazioni"

WhatsApp: Phase 3, da implementare solo quando base Telegram è consolidata.

---

## 11. Fasi di build

### Phase 2a — Foundation (2 settimane)
1. Deploy Payload CMS su Railway con collections `products`, `orders`, `customers`
2. Seed prodotti (7 SKU + varianti) nel CMS
3. Next.js storefront: homepage + pagine sezione + pagina prodotto
4. Revolut checkout integrato e testato
5. Webhook Revolut → nanobot → Telegram Alessandro

### Phase 2b — Integrazione nanobot (1 settimana)
1. Tool Telegram per gestione prodotti via chat
2. Flow onboarding cliente Telegram
3. Connessione pipeline Phase 1 (già live) con nuovi ordini storefront
4. Pagina /ordine/[id] per tracking cliente

### Phase 2c — Polish (1 settimana)
1. Design finale (foto prodotti, copy, mobile)
2. DNS switch thefoolishbutcher.com → nuovo storefront
3. Test end-to-end completo
4. Monitoring (Railway metrics + alert nanobot se checkout fallisce)

---

## 12. Environment variables aggiuntive

```
# Payload CMS
PAYLOAD_SECRET=<random 32 char>
PAYLOAD_PUBLIC_URL=https://admin.thefoolishbutcher.com
DATABASE_URI=postgresql://...  # schema foolish_cms

# Revolut
REVOLUT_API_KEY=<merchant API key>
REVOLUT_WEBHOOK_SECRET=<HMAC secret>
REVOLUT_MODE=sandbox  # → live al lancio

# Next.js
NEXT_PUBLIC_PAYLOAD_URL=https://admin.thefoolishbutcher.com
NEXT_PUBLIC_REVOLUT_PUBLIC_KEY=<pk_...>
STOREFRONT_URL=https://thefoolishbutcher.com
```

---

## 13. Out of scope Phase 2

- WhatsApp (Phase 3)
- Sistema subscription / abbonamenti
- Wishlist / account cliente sul sito
- Recensioni integrate
- Blog / contenuti editoriali
- Multi-lingua (solo IT per ora)
- App mobile nativa

---

## 14. Decisioni confermate

- [x] **Dominio:** thefoolishbutcher.com — stesso dominio, DNS switch al lancio
- [x] **Foto:** sito attuale come base, nuove foto integrate durante produzione
- [x] **Spedizione:**
  - Italia: 7,65€ (gratis sopra 50€)
  - Europa: 14,99€ (gratis sopra 150€)
  - Resto del mondo: 37,95€ (gratis sopra 250€)
  - Phase 3: integrazione Packlink Pro per tariffe reali in tempo reale
- [x] **IVA:** inclusa nei prezzi esposti
- [x] **Stock limitato:** sezione separata, non sempre visibile, appare solo quando popolata — forte urgency
- [x] **Payload admin:** solo Alessandro

## 15. Spedizione — logica calcolo

```
function calculateShipping(cartTotal, country):
  if country == 'IT':
    return cartTotal >= 50 ? 0 : 7.65
  if country in EU_COUNTRIES:
    return cartTotal >= 150 ? 0 : 14.99
  else:  # resto del mondo
    return cartTotal >= 250 ? 0 : 37.95
```

Packlink Pro Phase 3: al checkout, dopo inserimento CAP/paese, chiamata API Packlink
per tariffa reale → sostituisce le tariffe fisse. Packlink già integrato in Phase 1 per tracking,
l'estensione per le tariffe è incrementale.
