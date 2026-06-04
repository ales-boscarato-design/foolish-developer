# Reviews — Design Spec

**Goal:** Raccogliere recensioni verificate dagli acquirenti (stelle + testo + foto opzionale), moderarle via Frank su Telegram, e visualizzarle in pagina prodotto, homepage e pagina dedicata.

**Architecture:** `marketing.reviews` in DB_FOOLISH · foto su Railway volume CMS · moderazione Frank webhook · display via query SQL dirette (no CMS Payload)

**Tech Stack:** Next.js App Router · postgres (porsager) · jose JWT · Railway volume `/data/media/reviews/` · nanobot webhook handler

---

## 1. Database

Nuova tabella `marketing.reviews` nel PostgreSQL DB_FOOLISH (stesso schema delle tabelle email marketing esistenti):

```sql
CREATE TABLE marketing.reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        INTEGER NOT NULL REFERENCES public.orders(id),
  product_id      INTEGER NOT NULL REFERENCES public.products(id),
  product_slug    TEXT NOT NULL,
  subscriber_id   UUID REFERENCES marketing.subscribers(id),
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            TEXT,
  photo_urls      TEXT[] NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'published', 'removed')),
  reviewer_name   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX idx_reviews_product_published ON marketing.reviews(product_slug, status);
CREATE INDEX idx_reviews_status ON marketing.reviews(status);
CREATE INDEX idx_reviews_order ON marketing.reviews(order_id);
```

---

## 2. Flusso invio review

### 2.1 Link nell'email review request

L'email review request esistente (`storefront/src/emails/review-request.tsx`) viene aggiornata per includere un link univoco:

```
https://thefoolishbutcher.com/[locale]/recensisci?token=<jwt>
```

**JWT payload** (firmato con `REVIEW_SECRET`, scadenza 30 giorni):
```json
{
  "orderId": 123,
  "productId": 45,
  "productSlug": "t-3d-woman-back",
  "subscriberId": "uuid"
}
```

Il cron review-request (`/api/cron/review-request`) genera il token prima dell'invio.

### 2.2 Pagina form

Route: `storefront/src/app/[locale]/recensisci/page.tsx`

- Legge e verifica il token JWT dal query param
- Se token invalido o scaduto → messaggio di errore gentile
- Se review già inviata per questo ordine → messaggio "Hai già lasciato una recensione"
- Form: stelle (1-5, required) + testo (textarea, opzionale) + foto (upload, opzionale, max 5MB, jpg/png/webp)
- Submit → `POST /api/review/submit`

### 2.3 API submit

Route: `storefront/src/app/api/review/submit/route.ts`

1. Verifica JWT
2. Controlla che non esista già una review per quell'ordine
3. Se foto allegata: salva in `/data/media/reviews/` sul volume CMS (stesso volume, sottocartella dedicata) via chiamata interna al CMS o scrittura diretta se accessibile
4. Inserisce in `marketing.reviews` con `status=pending`
5. Chiama Frank webhook `POST /hooks/foolish-storefront-review`
6. Risponde con successo → pagina di ringraziamento

**Foto upload:** `POST /api/review/photo` — riceve multipart form, salva sul volume, restituisce path. Chiamato dal frontend prima del submit del form.

---

## 3. Moderazione Frank

### 3.1 Webhook storefront → Frank

Dopo ogni nuova review, il storefront fa POST a:
```
https://nanobot.thefoolishbutcher.com/hooks/foolish-storefront-review
```

Payload:
```json
{
  "reviewId": "uuid",
  "productName": "T-3D Woman Back",
  "productSlug": "t-3d-woman-back",
  "rating": 5,
  "body": "Texture incredibile...",
  "reviewerName": "Mario R.",
  "photoUrls": ["/reviews/foto.jpg"],
  "moderateUrl": "https://thefoolishbutcher.com/api/review/moderate"
}
```

### 3.2 Messaggio Telegram di Frank

```
⭐⭐⭐⭐⭐ — Mario R.
Prodotto: T-3D Woman Back

"Texture incredibile, lo stencil tiene benissimo."

📸 1 foto allegata

[✓ Pubblica]  [✗ Rimuovi]
```

### 3.3 API moderazione

Route: `storefront/src/app/api/review/moderate/route.ts`

- Protetta da `REVIEW_ADMIN_SECRET` (header Bearer, stesso pattern CRON_SECRET)
- Params: `reviewId`, `action` (`publish` | `remove`)
- `publish` → `status=published`, `published_at=NOW()`
- `remove` → `status=removed`
- Frank aggiorna il messaggio Telegram con esito ("✅ Pubblicata" / "🗑 Rimossa")

**Timeout:** review non moderate restano `pending` indefinitamente — non appaiono mai sul sito, non vengono cancellate.

### 3.4 Handler nanobot

Nuovo `elif` in `nanobot/cli/commands.py`:
```
POST /hooks/foolish-storefront-review
```
- Parsa il payload
- Costruisce il messaggio con stelle Unicode + testo + note foto
- Invia a Alessandro con inline keyboard [Pubblica] [Rimuovi]
- I callback dei bottoni chiamano `moderateUrl` con `REVIEW_ADMIN_SECRET`

---

## 4. Display

### 4.1 Pagina prodotto

Sezione sotto la descrizione completa del prodotto.

**Header:**
- Media stelle calcolata (es. ★ 4.8 · 12 recensioni)
- Distribuzione stelle (barra orizzontale 5→1)

**Lista review:**
- Ordinate per `published_at DESC`
- Max 5 visibili, bottone "Mostra tutte" → `/[locale]/recensioni?prodotto=slug`
- Ogni card: stelle + nome reviewer + data + testo + foto (click → lightbox)

**Query:** `SELECT * FROM marketing.reviews WHERE product_slug=$1 AND status='published' ORDER BY published_at DESC LIMIT 5`

### 4.2 Homepage — citazione rotante

Sezione discreta, inserita tra sezioni esistenti. Nessuna card, nessun bordo.

- Una citazione alla volta, crossfade ogni 6 secondi
- Solo review con `rating >= 4` e `body IS NOT NULL`
- Layout: stelle piccole · testo in corsivo · nome + prodotto in muted

```
★★★★★

"Texture incredibile, lo stencil tiene benissimo."

— Mario R. · T-3D Woman Back
```

**Query al build:** fetch delle ultime 10 review pubblicate con rating≥4 e body non nullo, passate come JSON al client component che gestisce la rotazione.

### 4.3 Pagina `/[locale]/recensioni`

- Tutte le review `status=published`, ordinate per `published_at DESC`
- Filtro prodotto (select dropdown) e filtro stelle (1-5, multiselect)
- Ogni card: foto prodotto + stelle + nome + testo + foto review (lightbox) + data
- Paginazione: 12 per pagina

---

## 5. Env vars da aggiungere su Railway

| Variabile | Scopo |
|-----------|-------|
| `REVIEW_SECRET` | Firma JWT token nel link email (30gg scadenza) |
| `REVIEW_ADMIN_SECRET` | Bearer token endpoint `/api/review/moderate` |
| `FRANK_REVIEW_WEBHOOK_URL` | `https://nanobot.thefoolishbutcher.com/hooks/foolish-storefront-review` |

---

## 6. File da creare / modificare

```
storefront/src/
├── app/
│   ├── [locale]/
│   │   ├── recensisci/page.tsx          ← form review con token JWT
│   │   └── recensioni/page.tsx          ← pagina tutte le review
│   └── api/
│       └── review/
│           ├── submit/route.ts          ← salva review + notifica Frank
│           ├── photo/route.ts           ← upload foto review
│           └── moderate/route.ts        ← pubblica/rimuovi (Frank callback)
├── components/
│   ├── ReviewForm.tsx                   ← form stelle + testo + foto
│   ├── ReviewList.tsx                   ← lista review (prodotto + /recensioni)
│   └── ReviewQuote.tsx                  ← citazione rotante homepage
└── lib/
    └── reviews-db.ts                    ← query helpers marketing.reviews

storefront/scripts/
└── migrate-reviews.sql                  ← CREATE TABLE marketing.reviews

nanobot/cli/commands.py                  ← nuovo handler POST /hooks/foolish-storefront-review

storefront/src/emails/
└── review-request.tsx                   ← aggiunta link token JWT
```

---

## 7. Fuori scope

- Review da visitatori non acquirenti
- Sistema di risposta pubblica alle review
- Integrazione con piattaforme esterne (Trustpilot, Google Reviews)
- Ordinamento review per utilità ("questa recensione è stata utile?")
