# Customer PWA — Design Spec
**Data:** 2026-06-09  
**Scope:** Area cliente personale PWA + email tracking + refactor sezione account

---

## 1. Obiettivo

Trasformare l'attuale sezione `/account` (lookup email+ordine, nessuna sessione) in una Progressive Web App personale che:

- Fidelizza il cliente con una storia che cresce nel tempo (collezione fogli, storico ordini)
- Riduce il tempo tra intenzione e riacquisto (quick reorder, wishlist, raccomandazioni Frank)
- Sostituisce Telegram come canale notifiche per chi non usa il bot
- Fornisce ad Alessandro uno strumento per caricare risorse dedicate per singolo cliente

**Incluso nel presente spec:** anche il fix immediato per l'email di tracking (hook CMS afterChange).

---

## 2. Architettura

### Approccio: A+ — Estendi Next.js esistente con confini netti

La PWA vive nello storefront Next.js esistente sotto il route group `(customer-app)`. Zero nuova infrastruttura Railway. La separazione dalla parte marketing è garantita dal route group — se Foolish scala, il route group si estrae in servizio separato senza riscrittura.

```
storefront/src/app/
├── (storefront)/          ← sito marketing esistente (invariato)
└── (customer-app)/
    └── account/
        ├── layout.tsx     ← PWA shell: auth check, bottom nav, manifest link
        ├── page.tsx       ← Home personale
        ├── login/
        │   └── page.tsx   ← form magic link
        ├── auth/
        │   └── page.tsx   ← verifica token magic link → set cookie
        ├── ordini/
        │   ├── page.tsx   ← lista storico ordini
        │   └── [id]/
        │       └── page.tsx ← dettaglio ordine
        ├── collezione/
        │   └── page.tsx   ← galleria fogli aggregata
        ├── file/
        │   └── page.tsx   ← file + wishlist
        └── profilo/
            └── page.tsx   ← preferenze, notifiche, Telegram
```

### PWA setup

- `storefront/public/manifest.json` — icone, theme_color `#0d0d0d`, background `#0d0d0d`, display `standalone`, start_url `/account`
- `storefront/public/sw.js` — service worker: cache shell app, offline fallback su `/account`
- Meta tag `<link rel="manifest">` solo nel layout `(customer-app)`
- Plugin `next-pwa` oppure service worker manuale (preferire manuale: più controllo, zero dipendenze extra)

---

## 3. Autenticazione — Magic Link

### Flusso

1. Cliente inserisce email su `/account/login`
2. Storefront chiama `POST /api/account/magic-link` con `{ email }`
3. API verifica che l'email esista in `marketing.subscribers` (ha almeno un ordine)
4. Genera token JWT firmato con `MAGIC_LINK_SECRET`, scadenza 15 minuti, payload `{ email, exp }`
5. Invia email via Resend con link `https://thefoolishbutcher.com/account/auth?token=<jwt>`
6. Cliente clicca → `/account/auth` verifica JWT → imposta cookie `foolish_session` (httpOnly, secure, SameSite=Lax, 30 giorni) con payload `{ email }`
7. `layout.tsx` legge cookie server-side → se assente redirect a `/account/login`

### Sicurezza

- Token JWT monouso: dopo verifica, il server salva `magic_link_used_at` su `marketing.subscribers` — riuso dello stesso token ritorna 401
- Rate limiting su `POST /api/account/magic-link`: max 3 richieste per email ogni 10 minuti (contatore in memory o Valkey già presente su Railway)
- Cookie `httpOnly` — non accessibile da JS client

### Variabili d'ambiente nuove

```
MAGIC_LINK_SECRET=<stringa random 32 char>
SESSION_SECRET=<stringa random 32 char>
```

---

## 4. Modifiche al modello dati

### 4.1 marketing.subscribers — nuovi campi

```sql
ALTER TABLE marketing.subscribers
  ADD COLUMN level TEXT CHECK (level IN ('tatuatore','pmu','studente','professionista')),
  ADD COLUMN styles TEXT[],                    -- ['linework_fine','blackwork','realism',...]
  ADD COLUMN magic_link_used_at TIMESTAMPTZ,   -- per invalidare token già usati
  ADD COLUMN push_subscription JSONB,          -- Web Push subscription object
  ADD COLUMN notify_orders BOOLEAN DEFAULT true,
  ADD COLUMN notify_new_batches BOOLEAN DEFAULT true,
  ADD COLUMN notify_offers BOOLEAN DEFAULT false;
```

### 4.2 Nuova collection CMS: CustomerFiles

```typescript
// cms/src/collections/CustomerFiles.ts
{
  slug: 'customer-files',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'file', type: 'upload', relationTo: 'media', required: true },
    { name: 'customer', type: 'relationship', relationTo: 'customers' }, // null = file per tutti
    { name: 'fileType', type: 'select', options: ['guide','video','resource'] },
    { name: 'active', type: 'checkbox', defaultValue: true },
  ],
  access: {
    read: ({ req }) => !!req.user,  // solo autenticati CMS
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  }
}
```

### 4.3 Nuova tabella: account.wishlist

```sql
CREATE SCHEMA IF NOT EXISTS account;

CREATE TABLE account.wishlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_email TEXT NOT NULL REFERENCES marketing.subscribers(email) ON DELETE CASCADE,
  product_slug TEXT NOT NULL,
  product_name TEXT NOT NULL,
  product_price NUMERIC(10,2),
  saved_at TIMESTAMPTZ DEFAULT NOW(),
  notified_at TIMESTAMPTZ,               -- quando è stato inviato l'avviso disponibilità
  UNIQUE (subscriber_email, product_slug)
);
```

---

## 5. API routes nuove (storefront)

| Method | Path | Scopo |
|--------|------|-------|
| POST | `/api/account/magic-link` | Genera e invia magic link |
| GET | `/api/account/auth` | Verifica token → set cookie sessione |
| POST | `/api/account/logout` | Cancella cookie |
| GET | `/api/account/me` | Dati cliente autenticato (ordini, profilo, file) |
| PATCH | `/api/account/profile` | Aggiorna level, styles, lingua, preferenze notifiche |
| POST | `/api/account/wishlist` | Aggiungi prodotto a wishlist |
| DELETE | `/api/account/wishlist/[slug]` | Rimuovi da wishlist |
| POST | `/api/account/push-subscribe` | Salva Web Push subscription |
| POST | `/api/account/reorder/[orderId]` | Pre-popola carrello Stripe da ordine precedente |

Tutte le route `/api/account/*` (tranne magic-link e auth) leggono il cookie `foolish_session` e ritornano 401 se assente.

---

## 6. Le 5 schermate

### 6.1 Home (`/account`)

Blocchi in ordine verticale:
1. **Header** — saluto con nome, livello cliente, totale ordini
2. **Ordine attivo** — visible se `pipelineState` non è `closed`/`delivered`. Mostra progress bar 4 step + ETA. Scompare automaticamente.
3. **Raccomandazione Frank** — il primo `contentBlock` attivo della collection `Customers` del cliente (tipo `offer` o `announcement`). Frank lo popola dal CMS.
4. **Ultimo ordine + Riordina** — quick reorder con 1 tap dall'ordine più recente consegnato
5. **Wishlist preview** — prime 3 voci della wishlist con link a `/account/file`

### 6.2 Ordini (`/account/ordini`)

- Lista cronologica inversa di tutti gli ordini del cliente (via email)
- Badge stato colorato: in corso `#c9a96e`, consegnato `#5a7a5a`
- Per ordini attivi: progress bar inline
- Per ordini consegnati: bottoni "Riordina" + "Dettaglio"
- Dettaglio (`/account/ordini/[id]`): timeline 4 step, foto fogli grid, tracking, reorder CTA

### 6.3 Collezione (`/account/collezione`)

- Aggrega tutte le `sheetPhotos` da tutti gli ordini del cliente
- Griglia 3 colonne, ordinata per data ricezione (più recente prima)
- Filtri: Tutti / A4 / A5 / XXL (derivati dal formato dell'ordine di appartenenza via `lineItems[].variantLabel` — ogni foto è associata all'ordine che la contiene, non ha un campo formato proprio)
- Fogli dell'ordine attivo: placeholder tratteggiato con count "+N in arrivo"
- Tap su foglio: mostra seriale, note flock, link all'ordine di appartenenza

### 6.4 File (`/account/file`)

- Tab "File" / "Salvati"
- **File**: lista `CustomerFiles` dove `customer = email` OR `customer = null` (globali), ordinati per `createdAt` desc. Icona PDF/video, nome, dimensione, data, bottone download.
- **Salvati (wishlist)**: lista `account.wishlist` del cliente. Prodotto disponibile → CTA "Acquista" (link product page). Prodotto non disponibile → CTA "Avvisami" (salva flag, Frank invia push/email quando torna).

### 6.5 Profilo (`/account/profilo`)

- Nome (read-only, da `marketing.subscribers`)
- Email (read-only)
- **Chi sei**: chip selezionabili `tatuatore | pmu | studente | professionista` → scrive `level` su subscriber
- **Stile preferito**: chip multi-select `linework_fine | blackwork | realism | old_school | watercolor | tribal | geometric` → scrive `styles[]`
- **Lingua**: chip lingua → scrive `locale` su subscriber
- **Notifiche**: 3 toggle — aggiornamenti ordine / nuovi lotti / offerte
- **Push status**: mostra se push è attiva, bottone "Attiva notifiche" se non lo è (chiama browser Notification API → salva subscription via `/api/account/push-subscribe`)
- **Telegram**: se `telegramId` non è collegato → link deep link bot. Se collegato → mostra username.
- **Logout**: cancella cookie sessione

---

## 7. Web Push Notifications

### Setup VAPID

```
VAPID_PUBLIC_KEY=<generato con web-push>
VAPID_PRIVATE_KEY=<generato con web-push>
VAPID_SUBJECT=mailto:alessandro@thefoolishbutcher.com
```

### Flusso attivazione

1. Cliente clicca "Attiva notifiche" in `/account/profilo`
2. Browser chiede permesso (`Notification.requestPermission()`)
3. Se concesso: service worker registra `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
4. Subscription JSON inviata a `POST /api/account/push-subscribe`
5. Salvata su `marketing.subscribers.push_subscription`

### Invio notifiche (da Frank o da cron)

Nuova funzione `sendPushNotification(email, { title, body, url })` in `storefront/src/lib/push.ts`:
- Legge `push_subscription` da DB
- Usa `web-push` library per inviare
- Fallback: se subscription non presente o scaduta → invia email via Resend

### Trigger notifiche

| Evento | Canale |
|--------|--------|
| Stato ordine cambia | Push (se attiva) o Telegram (se collegato) o email |
| Prodotto wishlist disponibile | Push + email |
| Nuovo file caricato da Alessandro | Push |
| Raccomandazione Frank (offerta) | Push (se `notify_offers=true`, rate limit 1/settimana verificato su `marketing.email_log` tipo `push_offer`) |

---

## 8. Email tracking (fix immediato)

### Hook `sendTrackingEmail` in `cms/src/collections/Orders.ts`

Aggiunto a `hooks.afterChange` accanto agli hook esistenti:

```typescript
async function sendTrackingEmail({ doc, previousDoc, operation }) {
  // Scatta solo se trackingNumber è appena stato valorizzato
  if (operation !== 'update') return;
  if (!doc.trackingNumber) return;
  if (previousDoc?.trackingNumber === doc.trackingNumber) return;

  await resend.emails.send({
    from: process.env.RESEND_FROM,
    to: doc.customerEmail,
    subject: getTrackingSubject(doc.customerLocale),
    html: renderTrackingEmail(doc),
  });
}
```

Template multilingue (5 lingue) con: numero tracking, corriere, link pagina ordine pubblica `/ordine/[pageToken]`.

---

## 9. Quick Reorder

`POST /api/account/reorder/[orderId]`:
1. Carica ordine dal CMS, estrae `lineItems`
2. Chiama Stripe `POST /v1/checkout/sessions` con gli stessi `line_items` (cerca price ID per slug prodotto)
3. Ritorna `{ url: checkoutSession.url }` — il client fa redirect

Se un prodotto non è più disponibile nel catalogo: lo esclude e avvisa nella response `{ url, skipped: ['nome prodotto'] }`.

---

## 10. Fasi di implementazione

### Fase 1 — Fix immediato (1-2 ore)
- Hook `sendTrackingEmail` nel CMS
- Template email tracking multilingue

### Fase 2 — Auth e shell PWA (1 giorno)
- Magic link API + email template
- Cookie sessione
- `layout.tsx` con auth check e bottom nav
- `manifest.json` + service worker base
- Login page

### Fase 3 — Home + Ordini (1 giorno)
- `/account` — Home con 5 blocchi
- `/account/ordini` — lista + dettaglio
- API `GET /api/account/me`

### Fase 4 — Collezione + File + Profilo (1 giorno)
- `/account/collezione`
- `/account/file` con tab wishlist
- `/account/profilo` con preferenze
- Collection CMS `CustomerFiles`
- Tabella `account.wishlist`
- API profile + wishlist

### Fase 5 — Web Push + Quick Reorder (1 giorno)
- VAPID setup
- Service worker push handler
- `sendPushNotification()` utility
- Quick reorder API
- Integrazione notifiche con Frank webhook

---

## 11. Dipendenze nuove

| Package | Scopo |
|---------|-------|
| `web-push` | Invio Web Push VAPID lato server |
| `jose` | JWT magic link — già presente nel progetto (`jwtVerify` usato in unsubscribe e review routes) |
| `web-push` | Invio Web Push VAPID lato server — da installare |

Nessun nuovo servizio Railway necessario.

---

## 12. Out of scope

- Social login (Google, Apple)
- Chat in-app con Frank (rimane su Telegram)
- Editor profilo foto avatar
- Condivisione collezione pubblica
- App nativa iOS/Android
