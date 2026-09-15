# Affiliazione: link, codice e statistiche

Come funziona il tracciamento delle vendite di un affiliato (es. Néstor) e cosa
serve per attivarlo.

## Il flusso completo

```
LINK            il cliente apre  thefoolishbutcher.com/it/a/<slug>
                        │
                        ▼
COOKIE          il server risolve lo slug nel CMS; se l'affiliato è attivo
                scrive il cookie first-party `foolish_ref` = slug
                (httpOnly, durata = "Finestra cookie" dell'affiliato)
                        │
                        ▼
CHECKOUT        se il cliente non ha inserito un codice, il server legge il
                cookie, risolve l'affiliato per slug e applica il suo codice
                sconto — come se il cliente l'avesse digitato
                        │
                        ▼
STRIPE          l'ordine porta i metadata affiliate_id / affiliate_slug /
                affiliate_promo_code (generati dal server, mai dal browser)
                        │
                        ▼
WEBHOOK         crea la conversione nel registro e collega l'ordine
                        │
                        ▼
REGISTRO        `affiliate_conversions`: importo eleggibile, aliquota,
                commissione, stato pagamento/rimborso
```

Due regole non negoziabili:

- **Il cookie non fa sconti per conto suo.** Porta solo uno slug: è il server a
  risolverlo nel CMS. Un cookie falsificato che punta a un affiliato inesistente
  o non attivo non produce né sconto né commissione.
- **Un codice digitato dal cliente vince sempre sul cookie.** Se il cliente
  inserisce un codice non valido il checkout si blocca con errore; se invece non
  è valido il codice *dell'affiliato* lo sconto viene semplicemente ignorato e
  la vendita non si blocca.

Nota tecnica: sul modello `Affiliates` il campo `promoCode` è una **relazione**
(`promo_code_id`), non il testo del codice. La risoluzione quindi fa due letture:
prima l'affiliato per slug, poi il documento `promo-codes` per id, e accetta solo
un codice **attivo** e di tipo **percent**. Un codice scritto direttamente nel
campo relazione non è contemplato e viene rifiutato.

## Link pubblici e link privati

| Link | Chi lo vede | A cosa serve |
|---|---|---|
| `/{locale}/a/{slug}` | chiunque (è il link da dare all'affiliato) | salva il cookie e rimanda alla home. Ammette `?to=/it/prodotto/...`: si accettano **solo percorsi relativi alla radice** (un URL assoluto, anche dello stesso sito, viene rifiutato) e il valore restituito viene ri-analizzato per garantire che resti sul sito |
| `/{locale}/a/{slug}/stats?token=...` | solo il proprietario del token | statistiche di vendita dell'affiliato (pagina `noindex`) |

Il token delle statistiche è un HMAC-SHA256 firmato con un segreto **dedicato**
(`AFFILIATE_STATS_SECRET`), troncato a 32 caratteri: non è salvato da nessuna
parte e non richiede login. Chi ha il link vede i numeri — quindi **non va
pubblicato**. Se `AFFILIATE_STATS_SECRET` non è configurato la pagina risponde
404 e lo script non genera il link: è voluto, così il link non può essere firmato
con il segreto API dello storefront.

La finestra del cookie è quella configurata sull'affiliato («Finestra cookie»),
con un **tetto di 180 giorni**: un link di referral non deve poter attribuire
vendite a distanza di anni.

Il parametro `?to=` è accettato solo se, dopo la risoluzione, l'origine coincide
con quella del sito. Non basta il prefisso `/`: il parser degli URL rimuove tab,
CR e LF, quindi `?to=/%09/evil.com` diventa `//evil.com` e uscirebbe dal sito pur
superando un controllo sul testo grezzo.

La pagina statistiche continua a funzionare anche se l'affiliato viene messo in
pausa o archiviato: lo sconto si ferma, i numeri già guadagnati restano visibili.

## Cosa mostra la pagina statistiche

Vendite attribuite, fatturato eleggibile, commissione maturata, aliquota attuale,
data dell'ultima vendita, ordini rimborsati, e a quanto ammonta il prossimo
scatto di commissione. Se il CMS non è raggiungibile la pagina dice che i dati
non sono disponibili invece di mostrare numeri parziali.

Limite noto: gli aggregati sono calcolati su un massimo di 500 righe di registro.
Se l'affiliato ne ha di più la pagina **rifiuta di mostrare i totali** invece di
mostrarne una parte (numeri incompleti sarebbero peggio di nessun numero). Se un
affiliato supera quella soglia va alzato il limite — o introdotta la paginazione —
insieme ai test.

## Vedere le vendite nel CMS

Nella scheda di un affiliato (Marketing → Affiliati) il campo **Vendite
attribuite** elenca le righe del registro collegate: sessione, ordine, importo
eleggibile, aliquota, commissione, stato pagamento. È in sola lettura.

L'elenco completo è in Marketing → Affiliate Conversions.

## Creare un affiliato

```bash
node scripts/create-affiliate.mjs \
  --name "Néstor" --slug nestor --code NEST15 \
  --email <email> \
  --percent 15 --step-percent 3 --threshold-euro 500 --max-percent 38
```

È idempotente: rilanciato sullo stesso slug aggiorna la configurazione. Quando si
sostituisce il codice, aggiornare prima l'affiliato e poi disattivare il vecchio
promo dal CMS senza cancellarlo: gli snapshot delle conversioni storiche restano
leggibili senza permettere nuove attribuzioni. Alla fine stampa il link di referral
e il link privato alle statistiche.

Credenziali: variabili d'ambiente oppure il file locale
`~/.hermes/secrets/foolish-cms.env` (permessi `600`):

```
PAYLOAD_PUBLIC_URL=https://cms-production-1e56.up.railway.app
CMS_ADMIN_EMAIL=...
CMS_ADMIN_PASSWORD=...
AFFILIATE_STATS_SECRET=...  # per firmare il link statistiche (stesso valore dello storefront)
STOREFRONT_URL=https://thefoolishbutcher.com
```

Lo script non stampa mai credenziali.

## Prima di andare online

Il link, la pagina statistiche e l'attribuzione richiedono che in produzione siano
presenti la tabella `affiliates`, `affiliate_conversions` e i campi
`affiliate_*` su `orders`: senza la migration applicata il CMS risponde ma non
esiste nessun affiliato da risolvere. L'ordine è quindi:

1. deploy del codice (storefront + CMS);
2. applicazione della migration (`down` distruttiva: mai automatica);
3. creazione dell'affiliato con lo script;
4. consegna all'affiliato del link pubblico e, se serve, del link statistiche.

## Variabili d'ambiente

| Variabile | Dove | A cosa serve |
|---|---|---|
| `PAYLOAD_API_SECRET` | storefront + CMS | legge affiliati e conversioni dal CMS (già presente) |
| `AFFILIATE_STATS_SECRET` | storefront | **obbligatoria** per la pagina statistiche: firma i token. Senza, la pagina risponde 404. **Cambiarla invalida i link statistiche già consegnati** |
| `STOREFRONT_URL` | storefront | base dei link generati |

## Test

```bash
cd storefront && npx tsx --test src/lib/affiliate-referral.test.ts
```

Coprono normalizzazione dello slug, risoluzione fail-closed dell'affiliato con la
**forma reale del CMS** (relazione come id numerico), risoluzione del codice via
`promo-codes`, aggregazione del registro, soglie di commissione, tetto della
finestra cookie e verifica del token.

Il test `resolves slug to promo code through both CMS calls (real contract)` è la
protezione chiave: se il campo relazione cambiasse forma, la risoluzione
fallirebbe in modo visibile invece di rendere la feature silenziosamente inerte.
