# B2B — un solo addebito possibile per lo stesso ordine

## Problema

`b2b/src/lib/stripe-intents.ts` creava la PaymentIntent con
`idempotencyKey = orderNumber`. Stripe conserva le chiavi di idempotenza per
**almeno 24 ore** e poi le puo' eliminare. Oltre quella finestra un retry dello
stesso ordine (stessa email + chiave client + righe + totale, quindi stesso
`orderNumber` deterministico) creava una **seconda** PaymentIntent: l'ordine
aveva due intent entrambe pagabili.

La chiave di idempotenza del provider non e' quindi una garanzia di lungo
periodo. L'invariante deve vivere sui nostri dati.

## Scelta: persistere l'id sull'ordine CMS (via a)

`cms/src/collections/Orders.ts` ha gia' `stripePaymentIntentId` (`text`,
`unique: true`, `readOnly` solo in admin: lo scrive l'API). **Nessun campo
nuovo, nessuna migration.**

`handleCreateIntent` crea l'ordine prima della PaymentIntent
(`createB2BOrder`), quindi al retry il documento e' gia' in mano e il suo
`stripePaymentIntentId` e' disponibile senza chiamate aggiuntive.

Flusso:

1. `existingOrderConflict` resta per primo: un ordine gia' pagato risponde
   `409 ordine_gia_pagato` prima di qualunque confronto.
2. `ensureOrderPaymentIntent` decide:
   - id assente -> `create` con chiave `orderNumber` (prima generazione);
   - id presente -> `retrieve(id, { expand: ['latest_charge'] })` e:
     - `requires_payment_method | requires_confirmation | requires_action` ->
       **riuso**, zero nuove intent;
     - `processing | requires_capture | succeeded`, oppure stato sconosciuto ->
       `already_paid`, zero nuove intent (fail-closed);
     - `canceled` -> nuova intent **solo** se non c'e' un addebito riuscito
       (`latest_charge.status === 'succeeded'` o `paid === true`), con chiave
       `` `${orderNumber}:after:${existingIntentId}` ``. Riusare `orderNumber`
       farebbe rigiocare da Stripe la intent annullata, restituendo un segreto
       inutilizzabile.
3. Prima di consegnare il `clientSecret`, la rotta collega l'id all'ordine
   (`linkB2BPaymentIntent`). Se il PATCH fallisce risponde `502 Errore
   pagamento` **senza** segreto: una intent il cui segreto non e' mai uscito
   non e' pagabile da nessuno, e il retry la ritrova.
4. `already_paid` risponde `409 ordine_gia_pagato` (stessa chiave i18n
   `errorOrdineGiaPagato`, nessuna nuova traduzione).

### Perche' non la Search API (via b)

`paymentIntents.search` per `metadata.orderNumber` e' stata scartata perche':

- la Search API ha consistenza differita (fino a ~1 minuto): non puo'
  garantire l'invariante sul confine di concorrenza;
- dipende da un servizio che non possiamo verificare senza accesso live;
- aggiunge una dipendenza di rete sul percorso caldo del pagamento, mentre il
  campo sull'ordine e' gia' letto.

## Cosa vede il rivenditore

Il 409 `ordine_gia_pagato` riusa la chiave i18n gia' esistente
`errorOrdineGiaPagato` (nessuna nuova traduzione, `b2b/messages/*.json`):

- it: "Questo ordine risulta già pagato. Non verrà addebitato di nuovo."
- en: "This order has already been paid. You will not be charged again."

Vale per tutti i casi in cui i soldi sono incassati **o** in volo
(`processing`, `requires_capture`, `succeeded`) e per gli stati che il codice
non riconosce: in quel caso il messaggio e' piu' prudente del vero stato, ma
non promette un secondo addebito. Nessun nuovo testo perche' nessuna nuova
situazione commerciale e' stata introdotta.

## Un dettaglio del brief che non tornava

Il brief chiede che `linkB2BPaymentIntent` **rifiuti** un id diverso da quello
gia' memorizzato (perche' sarebbe il segnale di due intent sullo stesso
ordine), ma chiede anche che, dopo un'annullamento, la rotta colleghi il nuovo
id. Le due regole si contraddicono proprio nel caso 4: l'ordine porta ancora
l'id annullato, il nuovo id e' diverso, e un rifiuto renderebbe impossibile il
rilancio.

Soluzione minima e fail-closed: `linkB2BPaymentIntent` accetta un
`replaceIntentId` opzionale. Senza di esso un id diverso resta un errore; la
rotta lo passa **solo** con l'id che `ensureOrderPaymentIntent` ha appena
verificato `canceled` e senza addebito riuscito. Non e' un overwrite cieco:
e' una sostituzione dichiarata di una generazione nota e non pagabile.

## Test e prova di mutazione

- Unita' (`stripe-intents.test.ts`): parametri invariati; riuso per i tre stati
  attivi; `already_paid` per gli stati in volo, `succeeded` e sconosciuti;
  annullamento con e senza addebito; propagazione degli errori.
- Rotta (`create-intent/route.test.ts`): stub HTTP fedele con clock iniettabile,
  TTL 24h, `retrieve`, PATCH CMS con `unique`, `cmsPatchFailures` e
  `stripeTimeoutAfterRegister`. Ogni caso R6 misura intent create e intent
  pagabili.
- Mutazione: su una copia temporanea di `stripe-intents.ts` il ramo di riuso e'
  stato neutralizzato (`if (!args.existingIntentId)` -> `if (true)`); i casi
  R6.2, R6.3, R6.4 e R6.7 diventano rossi, poi il file corretto e' stato
  ripristinato.

## Residuo noto: ordini creati prima del deploy (gap tracciato in t_ae0061b1)

Il codice pre-deploy non memorizzava l'id della PaymentIntent sull'ordine: un
ordine rimasto pendente in quello stato ha `stripePaymentIntentId` nullo e, lato
dati, non e' distinguibile da un ordine mai passato dalla rotta nuova.

Al retry il ramo "id assente" di `ensureOrderPaymentIntent` rifa `create` con la
chiave `orderNumber`. Entro la finestra di 24h Stripe riconosce la chiave; oltre
la finestra la considera nuova e produce una **seconda** PaymentIntent pagabile,
mentre la prima resta pagabile: due addebiti possibili sullo stesso ordine.

Il buco non scade da solo perche' `orderNumber` e' deterministico (email + chiave
client + righe + totale): lo stesso carrello ritentato anche a mesi torna sullo
stesso ordine, che continua a non avere l'id memorizzato.

La prova e' una sonda con la rotta vera e lo stub del repository (stessa
infrastruttura di `route.test.ts`), non con Stripe vero. Output letterale:

```text
creazione: 200 | intent create: 1 | id persistito: pi_test_1
stato pre-deploy: id persistito azzerato sull'ordine
retry dopo 25h: 200
intent create totali: 2
intent pagabili: 2
secret client 1 diverso da secret client 2: si
```

L'invariante diventa assoluta solo con il **backfill degli ordini pendenti senza
id**, che vive nella card figlia **t_ae0061b1**, non in questa card. Le due vie
possibili sono:

- una guardia fail-closed sul ramo legacy: un ordine pendente senza id non crea
  una nuova PaymentIntent finche' il backfill non l'ha risolto;
- una ricerca su Stripe con `paymentIntents.search` per `metadata.orderNumber`,
  con i limiti di consistenza differita gia' discussi sopra.

La scelta tra le due e' di Alessandro, non di questa card.

Il test di caratterizzazione **R7.1** fissa oggi questo comportamento in CI. Se
diventera' rosso, il gap e' stato chiuso o peggiorato: test e documento vanno
aggiornati insieme alla card t_ae0061b1, senza "aggiustare" il test per farlo
tornare verde.

## Cosa non e' stato dimostrato

- Nessun test contro Stripe vero: lo stub riproduce TTL, `expand`,
  `latest_charge` e stati, non il comportamento completo del provider.
- Nessun test del webhook reale: `updateB2BPayment` resta invariato e rifiuta
  un id diverso, ma non e' stato esercitato contro il CMS vero.
- Nessuna migration e nessun deploy: il campo esisteva gia'.
- Resta un residuo teorico di corsa sull'annullamento: se un addebito riuscito
  arrivasse **dopo** la `retrieve` che ha visto `canceled` senza charge, la
  rotta potrebbe creare una nuova intent. La finestra e' stretta e il webhook
  la intercetta come id diverso, ma non e' coperta da un test.
- Il caso 7 (PATCH fallito) riusa la stessa intent grazie alla chiave del
  provider ancora valida; la persistenza interviene dal retry successivo (il
  test lo verifica avanzando di 25h).
- Il residuo degli ordini creati prima del deploy (id non memorizzato) e'
  documentato sopra e fissato da R7.1, ma non e' chiuso: la chiusura e' delegata
  alla card t_ae0061b1.
