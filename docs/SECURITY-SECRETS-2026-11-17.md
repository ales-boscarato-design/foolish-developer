# Un segreto per servizio, con permessi limitati al necessario

Card kanban `t_07fc89dd` — audit sicurezza 17/11/2026, rilievi 11 e 09.

Questo documento descrive il codice e la procedura preparati dalla card. **La rotazione
dei segreti in produzione e' un'azione del proprietario**: qui non e' stata eseguita
nessuna rotazione, nessun deploy, nessuna chiamata reale al CMS con i nuovi valori e
nessuna scrittura su CMS o database.

## 1. Servizio -> segreto -> permessi

Prima della modifica `PAYLOAD_API_SECRET` era lo stesso valore su Storefront, CMS e B2B,
e nel CMS apriva read/create/update su tutte le collection elencate. Ogni servizio poteva
quindi scrivere come se fosse uno degli altri.

Autorita' in scrittura per servizio, dedotta da cio' che il codice scrive davvero:

| scope | collection | operazioni ammesse con il segreto |
|---|---|---|
| storefront | orders | read, create, update |
| storefront | media | read, create |
| storefront | subscriptions | read, create, update |
| storefront | subscription-plans | read |
| storefront | affiliates | read |
| storefront | affiliate-conversions | read (piu' i tre custom endpoint, vedi sotto) |
| storefront | customer-files | read |
| storefront | offer-config | read |
| storefront | push-sequences | read |
| b2b | orders | read, create, update |
| catalog | products | create, update (solo lo script `import-products.mjs`) |
| (nessuno) | products | read e' pubblica: resta `() => true` |
| (nessuno) | customers, pro-members, promo-codes, announcements | solo `req.user` |
| (nessuno) | delete su tutte le collection | solo `req.user` |

La matrice vive in `cms/src/lib/serviceAccess.ts` (`SERVICE_PERMISSIONS`) e viene applicata
dalle access function reali delle collection. Il segreto viaggia sempre nell'header
`x-storefront-secret`; il valore viene risolto nello scope `storefront`, `b2b` o `catalog`
con `crypto.timingSafeEqual`, fail-closed se nessun segreto e' configurato.

### Nota obbligatoria sul residuo «abbonamenti»

La card dice che «lo storefront non deve poter scrivere su prodotti o abbonamenti».

- **Prodotti: soddisfatto.** Lo scope storefront non ha `products.create` ne'
  `products.update`; la scrittura e' riservata allo scope `catalog`
  (`import-products.mjs`). La lettura resta pubblica.
- **Abbonamenti: NON soddisfatto, e dichiarato.** Lo storefront scrive davvero le
  subscriptions: l'area cliente cancella l'abbonamento con una `PATCH`
  (`storefront/src/app/api/account/subscription/cancel/route.ts:30-34`) e cambia zona
  con una `PATCH` (`storefront/src/lib/subscription-zone-change.ts:163-167`). Togliere
  `subscriptions.update` allo scope storefront romperebbe l'area cliente. La correzione
  minima applicata e' quindi «permessi limitati a cio' che il servizio scrive davvero»;
  il permesso residuo resta visibile nella matrice e in questo documento, non nascosto.

## 2. Variabili da creare e da rimuovere su Railway

Valori distinti per servizio, generati separatamente. Nessun valore va scritto in chat,
in un commit o in questo documento.

| servizio Railway | variabili da creare | variabile da rimuovere dopo la rotazione |
|---|---|---|
| CMS | `STOREFRONT_API_SECRET`, `B2B_API_SECRET`, `CATALOG_API_SECRET` | `PAYLOAD_API_SECRET` |
| Storefront | `STOREFRONT_API_SECRET`, `FOOLISH_ADMIN_SECRET` | `PAYLOAD_API_SECRET` |
| B2B | `B2B_API_SECRET` | `PAYLOAD_API_SECRET` |

Note operative:

- Lo script `import-products.mjs` richiede `CATALOG_API_SECRET` e si ferma con un errore
  esplicito se manca. Non usa piu' il segreto dello storefront.
- `FOOLISH_ADMIN_SECRET` protegge gli endpoint interni dello storefront
  `POST /api/admin/create-offer` (header `x-admin-secret`) e
  `GET /api/marketing/stats` (header `x-storefront-secret`). Durante la transizione il
  codice accetta, in ordine, `FOOLISH_ADMIN_SECRET`, poi `STOREFRONT_API_SECRET`, poi
  `PAYLOAD_API_SECRET`.
- Il CMS accetta ancora `PAYLOAD_API_SECRET` come alias legacy dello scope `storefront`
  e logga **un solo warning per processo**. Serve solo a non rompere il deploy durante la
  transizione e va rimosso.

## 3. Ordine di rotazione sicuro

1. **Creare le variabili nuove e distribuire il codice che le legge con fallback.**
   Su CMS, Storefront e B2B si impostano i nomi nuovi (anche vuoti) e si fa deploy di
   questo codice, che legge prima i nomi nuovi e poi il legacy. Nessun servizio cambia
   comportamento finche' i valori nuovi non sono impostati.
2. **Generare un valore casuale per servizio.** Per ogni variabile:
   `openssl rand -hex 32`. Il valore si incolla direttamente nella UI Railway del
   servizio interessato: mai in chat, mai in un commit, mai in un file del repository.
   I valori devono essere diversi tra Storefront, B2B e Catalog.
3. **Verificare con i valori nuovi ancora in ombra.** Prima di rimuovere il legacy, si
   puo' impostare un solo servizio alla volta e controllare che il servizio funzioni.
4. **Rimuovere `PAYLOAD_API_SECRET` dai tre servizi** (CMS, Storefront, B2B) e rifare il
   deploy/restart. Da questo momento il fallback legacy non ha piu' un valore.
5. **Verificare il comportamento dopo la rimozione:**
   - Storefront: una pagina prodotto pubblica e un ordine di prova **non pagato**
     (creazione ordine via flusso di checkout, senza addebito) devono funzionare.
   - B2B: login e prezzi del carrello devono funzionare.
   - CMS: l'accesso admin deve funzionare.
6. **Rollback:** rimettere `PAYLOAD_API_SECRET` nei servizi che smettono di funzionare.
   Il codice accetta ancora il legacy come scope storefront, quindi il rollback e'
   immediato e non richiede un redeploy del codice.

La rimozione del legacy e' l'unico passo che cambia davvero l'autorizzazione: finche'
resta impostato, un servizio che ne conosce il valore puo' ancora presentarsi come
storefront.

## 4. Cosa resta aperto

- **Fallback legacy nel codice.** `cms/src/lib/serviceAccess.ts` mappa ancora
  `PAYLOAD_API_SECRET` su `storefront`; gli helper `cmsServiceSecret()` /
  `adminSecret()` lo usano come ultimo fallback. Va eliminato dopo la rotazione, insieme
  alla variabile su Railway.
- **Custom endpoint di `AffiliateConversions`.** I tre endpoint (creazione conversione,
  attribuzione ordine, transizione rimborso) usano
  `resolveServiceScope(req.headers) === 'storefront'` e non hanno un segreto dedicato:
  condividono l'header `x-storefront-secret`. Restano quindi raggiungibili da chiunque
  possieda il segreto dello storefront.
- **Residuo «lo storefront puo' aggiornare le subscriptions».** Motivazione e righe:
  `storefront/src/app/api/account/subscription/cancel/route.ts:30-34` (PATCH di
  `status: 'canceling'`) e `storefront/src/lib/subscription-zone-change.ts:163-167`
  (PATCH di `zone`). Rimuovere il permesso romperebbe cancellazione e cambio zona
  dall'area cliente.
- **Fallback degli endpoint interni.** Se `FOOLISH_ADMIN_SECRET` non e' impostato,
  `POST /api/admin/create-offer` e `GET /api/marketing/stats` accettano ancora
  `STOREFRONT_API_SECRET` (e in ultima istanza il legacy). Dopo la rotazione va impostato
  un valore dedicato, cosi' il segreto di servizio non apre piu' questi endpoint.

## 5. Proprieta' dell'azione

Questa card prepara solo codice, test e procedura. La generazione dei valori, la loro
impostazione su Railway, la rimozione di `PAYLOAD_API_SECRET` e il rollback sono azioni
del proprietario e non sono state eseguite qui.
