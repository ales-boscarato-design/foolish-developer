# Gate pre-deploy

`scripts/release-gate.mjs` è il controllo che gira **prima** che una modifica arrivi su `main`.
Non prova il comportamento dell'applicazione: quello lo fanno i test. Prova le cose che i test
non vedono — cioè i contratti fra file, che si rompono in silenzio e si scoprono in produzione.

```bash
# in locale, sul branch di lavoro
node scripts/release-gate.mjs

# test del gate stesso (casi negativi inclusi)
node --test scripts/release-gate.test.mjs

# in CI: i lockfile li prova l'installazione, quindi il gate non li ripete
node scripts/release-gate.mjs --ci --base "$(git rev-parse origin/main)"
```

Exit code `1` se un controllo fallisce. `--json` per l'output leggibile da una macchina.

## Cosa controlla, e perché

| Controllo | Il difetto che intercetta |
|---|---|
| File richiesti presenti | un file del percorso "soldi" spostato o rinominato senza aggiornare chi lo legge |
| Migration registrate in `index.ts` | una migration scritta ma non registrata: con `push: false` i campi non esistono nel database di produzione |
| `push: false` in `payload.config.ts` | qualcuno attiva la sincronizzazione automatica dello schema: le migration smettono di essere la verità |
| Parità delle chiavi i18n nei 5 file `messages/*.json` | una pagina tradotta a metà: chiave presente in italiano e assente altrove |
| Metadata del checkout verso i percorsi "soldi" | il checkout smette di scrivere una chiave (`order_ref`, `items_json`, `affiliate_slug`…) che il webhook o la riconciliazione leggono: ordini senza riferimento, righe senza SKU |
| Tipi CMS rigenerati col cambio schema | una collection modificata senza `npx payload generate:types`: i tipi raccontano uno schema che non esiste |
| Nessun deploy o migration nei workflow | una CI che deploya o migra da sola, scavalcando il merge su `main` e la verifica umana |
| Nessun segreto nei file versionati | una chiave `sk_live_`, un `whsec_`, un token GitHub o una chiave privata finita in un commit |
| Lockfile sincroni con `package.json` | il caso `npm ci` che fallisce — cioè una CI che non può girare, o una build che installa versioni diverse da quelle bloccate |

Ogni controllo nasce da un problema reale, non da un'ipotesi: la migration non registrata e il
webhook che legge metadata diversi da quelli scritti sono guasti veri già visti su questo sito.

## Cosa NON fa

- **Non deploya e non migra.** Il deploy lo fa Railway dal merge su `main`; le migration le applica
  il servizio CMS all'avvio. Il gate verifica che nessun workflow si prenda quel compito.
- **Non sostituisce i test.** I test unitari e di route restano la prova del comportamento:
  `storefront/src/lib/*.test.ts` e `scripts/release-gate.test.mjs`.
- **Non conosce lo stato della produzione.** Un gate verde non dice che il sito è sano: quello si
  verifica dopo il deploy, interrogando il sito vero.

## Come si estende

1. Aggiungi la logica **pura** al gate (`compare…`, `extract…`, `scan…`) ed esportala.
2. Aggiungi il controllo che la usa.
3. Aggiungi in `scripts/release-gate.test.mjs` **un caso che fallisce**: un gate che non sa fallire
   non è un gate. I test sintetici coprono i casi negativi; gli invarianti reali chiudono il cerchio
   sul repository.

## Due dettagli che fanno passare un gate che in CI fallirà

- **I controlli basati sul diff guardano i file committati.** Su un albero con file nuovi non ancora
  tracciati il gate non li vede: eseguilo **dopo il commit**, o il verde locale non vale. È il modo in
  cui il controllo sui segreti ha lasciato passare, in locale, un file nuovo che in CI ha poi segnalato.
- **Il gate scansiona anche i file del gate.** Nei test non si scrivono stringhe che *sembrano*
  segreti, nemmeno finte: si compongono a runtime (`['whsec', 'abcdef'].join('_')`), altrimenti il
  gate segnala se stesso.
