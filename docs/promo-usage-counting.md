# Uso dei codici promo: si conta dagli ordini

## Regola

L'**ordine è la fonte di verità** dell'uso di un codice promo. Dal 27/10/2026 ogni ordine
creato dallo storefront porta lo snapshot del promo applicato al checkout:

| campo ordine | significato |
|---|---|
| `promoCode` | codice usato, normalizzato in uppercase (stessa forma di `PromoCodes.code`) |
| `promoType` | tipo del promo al momento dell'ordine |
| `promoDiscountCents` | sconto concesso, in centesimi interi |

Sono valori **storici** (snapshot), non riferimenti vivi: se domani il codice viene
disattivato o cambia, l'ordine continua a dire cosa era stato applicato.

Il codice è normalizzato in **uppercase sia in scrittura sia nel CMS** (hook
`normalizePromoCodeField` su `Orders`), quindi una scrittura manuale in minuscolo non crea
un ordine introvabile: viene convertita prima di salvare.

`PromoCodes.usageCount` **non è affidabile come contatore**: nessun percorso lo incrementa
(l'unica scrittura è l'inizializzazione a 0 alla registrazione Pro), ma i valori storici non
vengono azzerati. Il campo resta per compatibilità dello schema ed è stato tolto dalle
colonne predefinite dell'admin. Non usarlo come contatore né come limite d'uso: l'uso si
conta dagli ordini, come qui sotto.

## Perché non un contatore

Un contatore da incrementare a ogni pagamento si disallinea appena il webhook viene
ritentato, arriva un evento doppio o un ordine viene creato dal riconciliatore. Il
conteggio derivato dagli ordini è sempre vero per costruzione, e non richiede scritture
sul percorso del pagamento.

## Come contare gli ordini di un codice

Amministrazione CMS → **Ordini**: la colonna `promoCode` è visibile nell'elenco e il campo
è nella ricerca della lista, quindi basta cercare il codice (uppercase) per avere gli
ordini.

La stessa cosa via API (sola lettura, con la chiave del profilo):

```bash
curl -s "$CMS_URL/api/orders?where\[promoCode\]\[equals\]=DAVIDSALAS&limit=100&depth=0" \
  -H "Authorization: users API-Key $CMS_API_KEY" \
| python3 -c 'import json,sys; d=json.load(sys.stdin); print("ordini:", d["totalDocs"]); print("sconto totale (EUR):", sum(o.get("promoDiscountCents") or 0 for o in d["docs"])/100)'
```

Per un periodo specifico aggiungere `where[createdAt][greater_than_equal]=2026-10-01`.
Se il numero di ordini supera `limit`, paginare con `page=2,3,...` (`totalDocs` è il
totale reale, non il numero di righe restituite).

## Esempio

`DAVIDSALAS` è il codice dell'accordo rivenditore configurato **in produzione** il
27/10/2026 (−30% da 200,00 € a 500,00 € inclusi, −35% oltre 500,00 €): quei parametri non
stanno nel repository e qui non sono verificabili, la fonte è il registro del caso (scheda
cliente e card kanban). Dal deploy di questa funzione in poi, gli ordini che usano quel
codice compaiono con `promoCode = DAVIDSALAS` e lo sconto in `promoDiscountCents`; gli
ordini precedenti non hanno i campi.

## Ordine di deploy

Le colonne `promo_*` le crea la migration, che il servizio CMS applica **al proprio avvio**
dopo il merge. Se lo storefront girasse prima che il CMS abbia applicato la migration, il
`POST /api/orders` con i campi promo verrebbe rifiutato: verificare dopo il deploy che la
migration risulti applicata (i campi compaiono nella risposta dell'API ordini) prima di
considerare attiva la tracciatura.

## Limiti noti

- Gli ordini creati **prima** del 27/10/2026 non hanno i campi promo: per quelli lo sconto
  era già dentro i prezzi netti delle righe e resta ricostruibile solo dai metadata della
  sessione Stripe.
- Un metadata promo illeggibile non blocca l'ordine: il codice viene conservato, lo sconto
  resta vuoto. In quel caso il conteggio degli ordini è corretto, il totale scontato no.
