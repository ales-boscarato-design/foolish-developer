# Coda di produzione dei fogli — contratto tecnico

Stato: **contratto pronto per l'implementazione** (card `t_610dd5ff`, 20/11/2026).
Base verificata: `origin/main` `a15d8452236bd2cbe908c094f351d71558a57a83`.
Implementazione di riferimento e prove: `storefront/src/lib/production-queue.ts`,
`storefront/src/lib/production-queue.fixtures.json`, `storefront/src/lib/production-queue.test.ts`
(20 test verdi, `npx tsx --test`; `tsc --strict --noEmit` sul modulo: 0 errori).

---

## 1. Cosa calcola

Una **stima**, non un conteggio contabile. Per ogni formato di foglio:

```
extraDays = 0                     se pezzi <= 20
extraDays = ceil(pezzi / 20) - 1  se pezzi > 20
giorniProduzione = productionDays + extraDays
```

`PRODUCTION_BATCH_SIZE = 20` è una costante nominata. La soglia è **inclusa**: 20 pezzi
restano nel giorno base, il 21° produce +1 (0→0, 19→0, 20→0, 21→1, 40→1, 41→2, 61→3).
La formula letterale `floor(n/20)` scritta nella card madre è incompatibile con questi
confini: qui vale la normalizzazione confermata da Alessandro il 20/11/2026 («dopo 20»).

I formati **non si sommano**: 25 A4 + 19 A5 danno +1 giorno sugli A4 e +0 sugli A5, non +2.
Per un carrello con più formati la promessa è il **massimo** fra i formati presenti.

L'errore deve cadere sempre dal lato prudente: **un giorno in più è accettabile, un giorno
in meno no**. Ogni regola sotto è scritta per non produrre mai una stima ottimistica.

---

## 2. Dati CMS: cosa esiste davvero

| Campo (`Orders`) | Tipo / valori | Chi lo scrive | Uso nel calcolo |
|---|---|---|---|
| `createdAt` | timestamp Payload, ISO 8601 UTC (`timestamps: true`, `cms/src/collections/Orders.ts:963`) | Payload, all'inserimento | **giornata di appartenenza** |
| `paymentStatus` | `pending` (default) / `paid` / `failed` / `refunded` / `cancelled` (`Orders.ts:725-737`) | storefront `paid`\|`pending` (`storefront/src/lib/stripe-orders.ts:151`); B2B `pending` (`b2b/src/lib/cms-orders.ts:104`); abbonamenti **non impostato** → default `pending` (`storefront/src/app/api/webhook/stripe/route.ts:129-145`); admin/CRM per gli altri valori | filtro di esclusione |
| `lineItems` | JSON **non tipizzato** (`Orders.ts:761-765`), forma scritta: `[{ sku, name, variantLabel, quantity, unitPrice }]` (`stripe-orders.ts:139-145`, `b2b/src/lib/cms-orders.ts:69-78`) | storefront, B2B, rinnovi abbonamento | SKU + quantità |
| `source` | `storefront` / `woocommerce` / `manual` / `reseller` / `subscription` (`Orders.ts:915-927`) | come sopra | non usato per filtrare (vedi §3) |
| `stripePaymentIntentId` | testo opzionale, unique (`Orders.ts:750-755`) | storefront | non necessario |
| `productionEtaDays` | numero (`Orders.ts:718`) | Alfred / CMS | snapshot della promessa una volta congelata |
| `refundStatus`, `amountRefundedCents`, `lastRefundedAt` | **non esistono su `main`**: li aggiunge la PR #69 (`origin/foolish/refund-orders-t_e5235dff`), non ancora unita | webhook Stripe | **deliberatamente ignorati** (§3) |

`lineItems` non ha uno schema: ogni consumatore deve **validare** (array, `sku` stringa non
vuota, `quantity` intero ≥ 1). Un payload non valido non si salta in silenzio: produce
`state: 'unavailable'` (§6), perché saltarlo abbasserebbe il conteggio.

Formato del foglio: **non esiste un campo dedicato**. Le varianti prodotto dichiarano
`sku`, `label` e `dimensions` (`cms/src/collections/Products.ts:286-351`), e la riga ordine
conserva `sku` e `variantLabel`. La mappatura è quindi derivata dal catalogo CMS (§4).

Quantità: `quantity` è **sempre il numero di pezzi**, anche per le righe pack. Il checkout
accetta SKU `<skuVariante>-pack-<id>` e impone `quantity % pack.quantity === 0` calcolando il
prezzo per pezzo (`storefront/src/lib/catalog.ts:88-94, 247-264`). Non serve moltiplicare per
la quantità del pack.

Tempi: `createdAt` è l'inserimento nel CMS, **non** l'istante certo del pagamento. Un
recupero tramite riconciliazione (`storefront/src/lib/stripe-orders.ts:193-256`,
`docs/stripe-order-recovery.md`) può creare l'ordine minuti o ore dopo il pagamento. Con la
giornata che si azzera a mezzanotte un ordine a cavallo può finire nella giornata
successiva: **accettato da Alessandro il 20/11/2026** come imprecisione della stima, non
come motivo di blocco.

---

## 3. Stati di pagamento: chi entra nella coda

| `paymentStatus` | In coda? | Perché |
|---|---|---|
| `paid` | **sì** | pagato |
| `refunded` | **sì** | un rimborso non restituisce i fogli già prodotti; contarlo gonfia la stima, quindi resta dal lato prudente |
| `pending` (o campo assente) | **sì** | i rinnovi abbonamento nascono senza `paymentStatus` e restano `pending` pur essendo pagati: escluderli sottostimerebbe. Le bozze B2B in attesa gonfiano soltanto |
| `failed` | **no** | pagamento mai riuscito: nessun foglio da produrre |
| `cancelled` | **no** | annullamento esplicito: l'ordine non entra in produzione |
| valore sconosciuto | **sì** | include-by-default: un valore nuovo non deve poter abbassare la stima |

Carrelli abbandonati non esistono in `Orders`: l'ordine nasce dal webhook Stripe o dal
checkout B2B. Non c'è quindi un "carrello" da escludere, se non le righe `failed`/`cancelled`.

Il webhook `charge.refunded` su `main` non aggiorna `Orders`
(`storefront/src/app/api/webhook/stripe/route.ts:177-190`): un ordine rimborsato può ancora
risultare `paid`. Non è un problema per questa stima — `paid` e `refunded` contano
entrambi — mentre resta un problema per ricavi e report (PR #69, card `t_e5235dff`).

---

## 4. Formato del foglio

### 4.1 Risoluzione

Indice `sku -> formato` costruito dal catalogo CMS (`GET /api/products`, campo `variants`):

1. `label` che inizia con `a3|a4|a5|a6|l|xxl|roll` → quel formato (`"A5 — Pelle"` → `a5`);
2. altrimenti dimensioni nell'etichetta o in `dimensions` (`"15×15"` → `15x15`, `"180×60 cm"` → `180x60`);
3. altrimenti **nessun formato dichiarato** → `null`.

La riga pack usa lo SKU di base: tutto ciò che precede `-pack-`
(`T-3D-WMN-BCK-PACK-2` → `T-3D-WMN-BCK`), case-insensitive.

### 4.2 SKU senza formato: mai ignorati

Un pezzo la cui riga non risolve un formato (SKU storico cancellato dal catalogo, variante
`Standard`, prodotto non-foglio, `SUB-TATTOO`, `SUB-TATTOO-GIFT`, …) viene **attribuito a
ogni formato della giornata** (`unknownPieces`). È over-counting deliberato: non sappiamo in
quale formato finirà, quindi non possiamo dichiarare che non occupi capacità. Gli SKU
coinvolti sono restituiti in `unknownSkus` per poterli mappare o escludere con una decisione
esplicita.

**Non esiste** un elenco `NON_SHEET` approvato: mani iperrealistiche, kit viso e sostegni
oggi ricadono in `unknownPieces`. Escluderli richiede una decisione di Alessandro (quali SKU
non consumano capacità dei fogli); fino a quella decisione la stima è più alta, mai più bassa.

### 4.3 Capacità per formato

L'unico valore dichiarato è 20 pezzi/giorno. La costante è unica per tutti i formati finché
Alessandro non dichiara capacità diverse (es. A5 vs XXL): il contratto espone
`batchSize` nella risposta per rendere il valore visibile e verificabile.

---

## 5. Giornata e fuso

- Giornata di calendario **Europe/Rome**, azzeramento a **mezzanotte** (conferma Alessandro
  20/11/2026: le 06:00 della card madre sono superate).
- La chiave si calcola con `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', ... })`,
  non sommando offset fissi: ora legale e ora solare sono gestite dal database IANA del
  runtime. Verificato: `2026-10-24T22:30Z` → `25/10 00:30 CEST`, `2026-10-25T01:30Z` →
  `25/10 02:30 CET`, `2026-03-29T22:30Z` → `30/03 00:30 CEST`.
- **Sabato e domenica si riportano al lunedì successivo**: un ordine delle 00:01 di sabato
  appartiene al lunedì. Il laboratorio non produce nel weekend; lasciare sabato e domenica in
  bucket separati sottostimerebbe il lunedì, quindi la card «soli giorni lavorativi» è
  applicata così.
- Confine: `23:59` Europe/Rome dentro la giornata, `00:01` nella successiva (test dedicati).

---

## 6. Contratto di risposta (storefront e checkout)

Tipi esportati da `storefront/src/lib/production-queue.ts`:

```ts
type ProductionQueueEstimate =
  | {
      state: 'ok'
      dayKey: string                 // giornata di produzione, YYYY-MM-DD
      computedAt: string             // ISO dell'istante di calcolo
      batchSize: number              // 20
      loads: Record<SheetFormat, number>            // pezzi per formato (formato ignoto già distribuito)
      extraDaysByFormat: Record<SheetFormat, number>
      extraDays: number              // massimo fra i formati richiesti
      requested: Array<{ sku: string; format: string | null }>
      unknownSkus: string[]
      unknownPieces: number
      excludedOrders: Array<{ orderNumber: string | null; reason: 'payment_failed' | 'cancelled' }>
    }
  | {
      state: 'unavailable'
      reason: 'invalid_payload' | 'incomplete_orders'
      detail: string
    }
```

Regole d'uso obbligatorie per chi consuma la risposta:

1. `state: 'ok'` è l'unico caso in cui si può mostrare una data derivata dalla coda.
2. `state: 'unavailable'` **non** equivale a `extraDays = 0`: il chiamante non deve mostrare
   la data base come se la coda fosse vuota. Deve dichiarare che la stima non è disponibile
   (o usare la formulazione già concordata per il guasto CMS), perché una data base durante
   un guasto è più ottimistica della realtà.
3. `extraDays` si somma a `productionDays` del prodotto (`ProductDetail.tsx:689-712` usa già
   `productionDays + shippingDays`); per un carrello con più formati si usa il massimo, mai la
   somma.
4. Al cliente **non** si mostra il contatore: solo il tempo di consegna risultante.
5. La promessa va ricalcolata **server-side** al checkout e congelata in
   `Orders.productionEtaDays`; il valore inviato dal client non è attendibile.

### Lettura CMS (per la card di implementazione)

```
GET {CMS_URL}/api/orders
    ?where[createdAt][greater_than_equal]=<ISO di 48h prima>
    &sort=-createdAt&depth=0&limit=500
Header: x-storefront-secret: $PAYLOAD_API_SECRET
```

- Finestra di 48h come **superset** della giornata: il filtro vero è la chiave Europe/Rome
  calcolata in codice, così non si costruiscono confini UTC a mano.
- Completezza: la risposta Payload espone `totalDocs`. Se `docs.length < totalDocs` (o
  `totalDocs > limit`) la lettura è troncata → `state: 'unavailable'`, `reason:
  'incomplete_orders'`. Un elenco troncato usato come completo è la via più facile per una
  stima ottimistica.
- Errori di rete / 401 / 5xx → `state: 'unavailable'`, mai `0`.
- Catalogo: stessa logica con `/api/products?limit=...&depth=0`; catalogo non leggibile →
  indice vuoto → tutti i pezzi finiscono in `unknownPieces` (prudente), non a zero.
- Cache: coerente con l'ISR del negozio (60 s). Nessuna scrittura.

---

## 7. Fixture e casi verificati

`storefront/src/lib/production-queue.fixtures.json` contiene documenti con la forma di
`GET /api/orders` (Payload) e prodotti con la forma di `GET /api/products`. Sono **sintetici
ma strutturalmente rappresentativi**: non sono ordini reali e non provano nulla sul catalogo
di produzione.

| scenario | now (UTC) | contenuto | esito atteso |
|---|---|---|---|
| `zero` | 20/11 12:00 | nessun ordine | a4 0, +0 |
| `19-a4` / `20-a4` / `21-a4` | 20/11 12:00 | 15+4 / 15+5 / 15+6 | +0 / +0 / +1 |
| `40-a4` / `41-a4` | 20/11 12:00 | 25+15 / 25+16 | +1 / +2 |
| `formats-separate` | 20/11 12:00 | 20 A4, 20 A5, 19 XXL | +0 su tutti e tre |
| `formats-not-summed` | 20/11 12:00 | 25 A4 + 19 A5 | A4 +1, A5 +0 |
| `payment-states` | 20/11 12:00 | 18 paid, 1 pending, 1 refunded, 30 failed, 30 cancelled | 20 pezzi, +0, 2 esclusi |
| `refunded-stays-counted` | 20/11 12:00 | 19 paid + 2 refunded | 21 pezzi, +1 |
| `excluded-only` | 20/11 12:00 | 10 failed + 10 cancelled | 0 pezzi, +0 |
| `other-day-ignored` | 20/11 12:00 | 50 pezzi del 19/11 | 0 pezzi, +0 |
| `midnight-before` | 20/11 23:30 Roma | 20 pezzi 23:59 + 5 pezzi 00:01 | 20 pezzi, +0 |
| `midnight-after` | 21/11 09:00 Roma | gli stessi ordini | 21 pezzi nel lunedì, +1 |
| `dst-end` | 25/10 12:00 | 20 + 1 a cavallo del cambio d'ora | 21 pezzi, +1, `dayKey 2026-10-26` |
| `dst-start` | 29/03 12:00 | 20 + 1 a cavallo del cambio d'ora | 21 pezzi, +1, `dayKey 2026-03-30` |
| `weekend-roll` | lunedì 23/11 | sab 6 + dom 7 + lun 8 | 21 pezzi, +1 |
| `unknown-sku` | 20/11 12:00 | 20 A4 + 1 SKU ignoto | A4 21, `unknownSkus ['LEGACY-XYZ']`, +1 |
| `pack-sku` | 20/11 12:00 | `DBL-A4-pack-3` × 21 pezzi | A4 21, +1 |
| `subscription-pending` | 20/11 12:00 | `SUB-TATTOO` + regalo, `paymentStatus` null | contati (2 pezzi ignoti), non esclusi |
| `format-from-dimensions` | 20/11 12:00 | `DBL-ROLL` 21, `FP-15` 20 | `180x60` +1, `15x15` +0 |
| `invalid-quantity` / `invalid-line-items` | 20/11 12:00 | payload corrotto | `unavailable`, `invalid_payload` |

Comando: `cd storefront && npx tsx --test src/lib/production-queue.test.ts` → **20/20 verdi**.

---

## 8. Limiti dichiarati e cose non provate

1. **Nessuna interrogazione al CMS di produzione**: il contratto deriva da codice, tipi e
   `cms/src/seed.ts`, non da ordini reali. Il catalogo di produzione può contenere SKU ed
   etichette diversi dal seed: la prima esecuzione reale deve riportare `unknownSkus` e
   `loads` osservati prima di mostrare la stima ai clienti.
2. `createdAt` non è l'istante del pagamento (riconciliazione ritardata): accettato come
   imprecisione della stima, può spostare un ordine di giornata.
3. Rimborsi: contati di proposito. I campi `refundStatus` della PR #69 non servono qui e non
   sono usati; quando la PR sarà unita la stima resterà identica.
4. Capacità: un solo valore (20) per tutti i formati; nessuna distinzione A4/A5/XXL è
   dichiarata nei dati. Il valore per formato è una decisione di business, non un dato.
5. Prodotti non-foglio e SKU `SUB-*`: oggi in `unknownPieces`, quindi gonfiano la stima.
   Servono un elenco `NON_SHEET` e la mappatura dell'abbonamento, altrimenti la stima resta
   prudente ma rumorosa.
6. `lineItems` non ha schema: un ordine con righe malformate blocca la stima (`unavailable`)
   invece di sottostimare. È voluto, ma va monitorato.
7. Weekend riportato al lunedì: se il laboratorio produce anche il sabato, la regola va
   rivista (oggi non è dichiarato da nessuna parte nel codice).
8. Il modulo non fa fetch né cache: la card `t_a00e9c1a` deve aggiungere il lettore CMS, la
   gestione errori, il ricalcolo al checkout, lo snapshot in `productionEtaDays` e la
   traduzione del messaggio «stima non disponibile» nelle cinque lingue.

---

## 9. Divergenze fra le fonti, risolte

| Fonte | Dice | Prevalenza |
|---|---|---|
| body card `t_610dd5ff` / `t_a00e9c1a` | azzeramento alle 06:00, `floor(n/20)` | **superate** |
| commento Alessandro 20/11/2026 | azzeramento a **mezzanotte** Europe/Rome, soglia inclusa, «dopo 20» | **in vigore** |
| commento Alessandro 20/11/2026 | contano gli ordini **creati** nella giornata, rimborsi compresi, errore sempre prudente | **in vigore** |

Resta una tensione non risolta da una decisione esplicita: la card madre dice «solo ordini
pagati» e «un rimborso esce dal conteggio», mentre la correzione del 20/11 dice che i
rimborsi non devono far scendere la stima. Il contratto applica la correzione (rimborsi
contati) perché è più recente e perché è l'unica coerente con «mai un giorno in meno».
