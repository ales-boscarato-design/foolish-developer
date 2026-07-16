# Printful × SEBO Merch — Design Spec

**Data:** 2026-07-16
**Scope:** `foolish-storefront/storefront/` + `foolish-storefront/cms/`
**Obiettivo:** Vendere merch a tema SEBO (sticker, t-shirt) prodotto e spedito da Printful, esposto in una galleria dentro la pagina `/[locale]/sebo` esistente, con fulfillment automatico verso Printful all'acquisto.

---

## Contesto e scope

Frank (Hermes) genera già concept di design merch SEBO tramite una skill dedicata (`sebo-pod`, fuori da questo repo) e ha già scelto Printful come piattaforma di stampa on-demand. Questo lavoro riguarda **solo il lato storefront**: una volta che un design è approvato e caricato come "sync product" su Printful (fuori scope qui — avviene sul dashboard Printful o via il tooling di Frank), il compito di questo repo è:
1. Farlo comparire nel catalogo Payload con dati corretti (nome, prezzo, varianti, ID Printful)
2. Mostrarlo in una galleria dentro `/sebo`
3. Venderlo con l'infrastruttura carrello/checkout già esistente
4. Inoltrare l'ordine a Printful per la stampa/spedizione, automaticamente

Fuori scope: generazione artwork, upload prodotti su Printful, gestione resi/rimborsi Printful, traduzione automatica delle descrizioni (Printful non la supporta — resta lavoro umano in Payload, come già oggi per tattoo/pmu).

---

## Schema CMS

**`Products`** (collection esistente) — estensioni:
- Campo `section`: nuova opzione `merch` (label "Merch SEBO"), accanto a tattoo/pmu/kit
- Nuovo campo top-level `printfulSyncProductId` (text, solo per prodotti merch) — ID del "sync product" Printful corrispondente
- Nuovo campo `printfulSyncVariantId` (text) dentro ogni riga dell'array `variants` esistente — ID della variante Printful (taglia/colore) corrispondente a quella riga

Nessuna nuova collection: i prodotti merch sono `Products` a tutti gli effetti, riusano `ProductCard`, `ProductDetail`, carrello, checkout esistenti senza modifiche a quei componenti.

## Sync manuale da Printful

Nuovo pulsante "Sincronizza da Printful" nell'admin Payload (componente custom nella collection `Products` o una pagina admin dedicata). Al click:
1. Chiama l'API Printful (catalogo sync products, richiede `PRINTFUL_API_KEY`)
2. Per ogni sync product Printful:
   - Se `printfulSyncProductId` non esiste ancora tra i `Products` Payload → crea un nuovo documento (`section: merch`, immagini/mockup da Printful, `variants` con relativo `printfulSyncVariantId` e prezzo, nome precompilato col nome grezzo Printful, descrizione vuota)
   - Se esiste già → aggiorna solo i campi tecnici (varianti, `printfulSyncVariantId`, immagini) e il prezzo; **non sovrascrive** `name`/`description`/`shortDescription` se già valorizzati manualmente
3. Nessuna esecuzione automatica/periodica — solo su richiesta esplicita dall'admin

Il completamento di nome e descrizione (nelle 5 lingue) resta un passaggio manuale in Payload dopo il sync, come per ogni altro prodotto.

## Galleria in `/sebo`

Nuova sezione nella pagina esistente `storefront/src/app/[locale]/sebo/page.tsx`: griglia di prodotti con `section: 'merch'` (foto, nome, prezzo), ognuno linkato alla pagina prodotto esistente `/[locale]/prodotto/[slug]`. `getProducts()` in `storefront/src/lib/cms.ts` va esteso per accettare anche `'merch'` come valore filtrabile (oggi tipizzato `'tattoo' | 'pmu'`).

Dalla pagina prodotto, tutto il resto (scelta variante/taglia, aggiunta al carrello, checkout) è già gestito dall'infrastruttura esistente, invariata.

## Fulfillment automatico

**Spedizione**: Printful spedisce dal proprio magazzino, indipendentemente da Foolish. Il prezzo dei prodotti merch include già il costo di spedizione Printful (nessuna modifica a `shipping.ts`, che continua a calcolare solo la spedizione dei prodotti Foolish sul totale carrello).

**Carrello misto**: un cliente può comprare merch + prodotti Foolish nello stesso ordine — è il caso atteso, non un'eccezione.

**Nuovo webhook indipendente**: `storefront/src/app/api/webhook/printful-fulfillment/route.ts`, separato dal webhook Stripe esistente (`api/webhook/stripe/route.ts`, non modificato). Ha un proprio signing secret (`STRIPE_PRINTFUL_WEBHOOK_SECRET`) e va registrato come endpoint webhook indipendente su Stripe Dashboard (passo manuale, stesso pattern già seguito per l'abbonamento) in ascolto su `checkout.session.completed`.

Flusso:
1. Verifica firma con `STRIPE_PRINTFUL_WEBHOOK_SECRET`
2. Legge `items_json` dai metadata della sessione (stesso formato già usato dal webhook esistente)
3. Per ogni riga con uno SKU corrispondente a una variante di un `Product` con `section: 'merch'`, recupera il relativo `printfulSyncVariantId`
4. Se almeno una riga è merch, chiama l'API Printful "crea ordine" con quelle righe (variant ID + quantità) e l'indirizzo di spedizione della sessione Stripe (stesso dato già raccolto da Stripe Checkout)
5. Le righe non-merch nello stesso carrello vengono ignorate da questo webhook (le gestisce il webhook esistente, invariato)
6. Idempotenza: verifica se un ordine Printful per quella `orderRef`/session id è già stato creato prima di crearne uno nuovo (stesso principio di idempotenza già usato altrove in questo progetto, contro i redelivery di Stripe)

## Variabili d'ambiente

- `PRINTFUL_API_KEY` — richiesta sia in `cms` (per il pulsante di sync) sia in `storefront` (per il webhook di fulfillment)
- `STRIPE_PRINTFUL_WEBHOOK_SECRET` — nuova, solo in `storefront`

## Fuori scope

- Generazione/upload artwork e prodotti su Printful (gestito da Frank/dashboard Printful)
- Traduzione automatica delle descrizioni (Printful non la supporta)
- Sync automatico/periodico (solo pulsante manuale)
- Costo di spedizione separato per il merch (assorbito nel prezzo prodotto)
- Gestione resi/rimborsi lato Printful
