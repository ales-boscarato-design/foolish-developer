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

`PromoCodes.usageCount` **non è mantenuto**: nessun percorso lo incrementa e resta a 0.
Il campo è conservato solo per compatibilità dello schema ed è stato tolto dalle colonne
predefinite dell'admin. Non usarlo come contatore né come limite d'uso.

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

## Esempio verificato

`DAVIDSALAS` (accordo rivenditore attivo dal 27/10/2026: −30% da 200,00 € a 500,00 €
inclusi, −35% oltre 500,00 €): gli ordini che lo usano compaiono con `promoCode =
DAVIDSALAS` e lo sconto in `promoDiscountCents`.

## Limiti noti

- Gli ordini creati **prima** del 27/10/2026 non hanno i campi promo: per quelli lo sconto
  era già dentro i prezzi netti delle righe e resta ricostruibile solo dai metadata della
  sessione Stripe.
- Un metadata promo illeggibile non blocca l'ordine: il codice viene conservato, lo sconto
  resta vuoto. In quel caso il conteggio degli ordini è corretto, il totale scontato no.
