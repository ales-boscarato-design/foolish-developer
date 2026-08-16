# Foolish Storefront — roadmap operativa

Questo documento è la fonte di verità per i fix di sicurezza, affidabilità e
infrastruttura emersi durante l'incidente degli ordini Stripe non registrati.
Deve essere aggiornato nello stesso commit delle modifiche che fanno avanzare
una fase.

Ultimo aggiornamento: 2026-08-16

## Regole di lavoro

- Lavorare esclusivamente nella repository
  `ales-boscarato-design/foolish-developer`, branch principale `main`.
- Alfred è il nanobot Foolish sulla Raspberry Pi 3. Il sorgente operativo è
  preparato in `/home/ab/nano-py` e il runtime remoto è
  `/home/nanobot-admin/foolish-core`.
- Frank è il nanobot locale legacy. Deve restare separato da Alfred durante la
  transizione e verrà fermato e disabilitato appena Alfred avrà superato i test
  di sicurezza e preso in carico le automazioni Foolish necessarie.
- Non stampare segreti in terminale, log, commit, documentazione o chat.
- Non usare credenziali amministratore dove basta una credenziale macchina
  limitata.
- Non modificare la PEC finché il proprietario non autorizza esplicitamente la
  migrazione al nuovo provider.
- Non riscrivere la storia Git e non effettuare force-push senza autorizzazione
  esplicita.
- Distribuire un servizio alla volta e conservare sempre un rollback noto.
- Non usare `npm audit fix --force`.
- Una casella può essere marcata completata solo quando esiste una prova
  verificabile nella sezione "Registro avanzamento".

## Legenda

- `[ ]` da fare
- `[~]` in corso o parzialmente completato
- `[x]` completato e verificato
- `[!]` bloccato o rinviato per decisione esplicita

## Stato sintetico

| Fase | Stato | Prossima azione |
| --- | --- | --- |
| 0. Credenziali e separazione | Completata, inclusa amministrazione CMS completa | Mantenere il controllo durante le fasi successive |
| 1. Dipendenze | Completata e distribuita | Mantenere audit; risolvere il debito lint separatamente |
| 2. Tunnel Alfred | Operativo sulla Raspberry; reboot fisico da verificare | Eseguire un riavvio amministrativo della Pi |
| 3. Affidabilità ordini | Completata e verificata | Mantenere test, cron e heartbeat giornaliero |
| 4. PEC e storia Git | Rinviata | Attendere il cambio provider |

## Baseline già verificata

- [x] Recuperati nel CMS i due PaymentIntent coinvolti nell'incidente, come
  ordini 25 e 26.
- [x] Audit di 365 giorni: 22 sessioni Storefront pagate e 22 ordini CMS,
  senza differenze.
- [x] Webhook Stripe configurato per fallire esplicitamente quando il CMS non
  registra l'ordine.
- [x] Persistenza ordine resa idempotente.
- [x] Riconciliazione automatica ogni 15 minuti e audit giornaliero.
- [x] Allarmi ridondanti Alfred e Resend.
- [x] Segreto webhook Alfred allineato tra Railway e Raspberry.
- [x] Forward Alfred corretto dall'IP LAN obsoleto all'indirizzo Tailscale.
- [x] CMS, Storefront e B2B distribuiti dal repository corretto.
- [x] Password CMS e Umami ruotate; le precedenti vengono rifiutate.
- [x] Cassaforte GPG locale creata in `~/.foolish-secrets`.
- [x] Vecchio stash con credenziali rimosso.
- [x] Alfred dispone di un'identita macchina Payload dedicata e di sette
  strumenti generici per amministrare interamente il CMS senza dipendere da
  shell o credenziali umane.

## Fase 0 — Credenziali e separazione Alfred/Frank

Obiettivo: l'account amministratore CMS deve servire soltanto per l'accesso
manuale. Alfred deve usare credenziali macchina limitate e sostituire
definitivamente Frank per l'operatività Foolish.

### Attività

- [x] Cercare tutti i consumatori di `FOOLISH_PAYLOAD_PASSWORD`,
  `CMS_ADMIN_PASSWORD` e `PAYLOAD_API_SECRET` senza stampare i valori.
- [x] Classificare ogni consumo come accesso umano, accesso Alfred, legacy o
  inutilizzato.
- [x] Verificare quali operazioni CMS esegue Alfred: lettura ordini, modifica
  stato, fatturazione e strumenti CLI legacy.
- [x] Introdurre un endpoint ordini dedicato ad Alfred con segreto separato e
  allowlist server-side dei campi modificabili.
- [x] Sostituire nell'ambiente Alfred il login amministratore con una
  credenziale macchina a privilegi minimi.
- [x] Verificare che lettura e aggiornamento degli ordini funzionino con la
  credenziale macchina.
- [x] Sostituire il login amministratore dell'upload foto recensioni con il
  machine secret già autorizzato esclusivamente dal controllo accessi Media.
- [x] Confrontare gli strumenti e i cron attivi tra Frank e Alfred.
- [x] Classificare i cron di Frank come Foolish, personali o infrastrutturali.
- [x] Replicare su Alfred i cron Foolish ancora necessari, senza abilitarli in
  contemporanea sui due agenti.
- [x] Osservare almeno un'esecuzione riuscita di ogni cron migrato su Alfred.
- [x] Disabilitare su Frank i cron Foolish solo dopo la relativa verifica su
  Alfred.
- [x] Fermare e disabilitare `frank.service` solo dopo tutti i test Alfred e la
  migrazione dei cron Foolish necessari.
- [x] Conservare configurazione e stato Frank per un rollback breve, senza
  lasciarlo in esecuzione.
- [x] Inventariare le chiavi contenute in `/home/ab/dev/temporaneo.txt`.
- [x] Salvare nella destinazione sicura corretta soltanto le chiavi ancora
  attive e necessarie.
- [x] Eliminare `/home/ab/dev/temporaneo.txt` solo dopo la verifica dei
  consumatori e del recupero dalla cassaforte.
- [x] Verificare che la password amministratore CMS resti soltanto nella
  cassaforte GPG e, finché necessario alla migrazione, nei runtime autorizzati.

### Verifiche obbligatorie

- [x] Login manuale CMS con la credenziale conservata in GPG: HTTP 200.
- [x] Vecchia password CMS: HTTP 401.
- [x] Operazione Alfred di lettura ordine riuscita.
- [x] Operazione Alfred di aggiornamento stato ordine riuscita.
- [x] Cron Foolish necessari presenti e verificati su Alfred.
- [x] Nessun cron Foolish eseguito contemporaneamente da Frank e Alfred.
- [x] `frank.service` fermo e disabilitato.
- [x] `temporaneo.txt` assente.
- [x] Ricerca finale dei nomi delle variabili sensibili senza valori o copie
  inattese.

### Criterio di chiusura

Alfred usa credenziali macchina limitate e ha preso in carico le automazioni
Foolish necessarie; Frank è fermo e disabilitato; il file temporaneo non esiste
e l'accesso amministratore è recuperabile dalla cassaforte GPG.

### Rollback

Prima di rimuovere una credenziale, conservarne una copia cifrata. Durante la
breve finestra di rollback è possibile riabilitare Frank, ma solo dopo aver
fermato i cron equivalenti su Alfred per evitare doppie esecuzioni.

### Estensione verificata — amministrazione CMS completa

Alfred non è limitato al solo flusso ordini. L'identita macchina è confinata
al CMS Foolish ma, al suo interno, dispone dei permessi effettivi di lettura,
creazione, modifica e cancellazione su tutte le collezioni correnti, comprese
prodotti, media, clienti, ordini, utenti e configurazioni. Le collezioni future
restano scopribili attraverso `/api/access` e utilizzabili dai tool generici nel
rispetto dei controlli accesso definiti da Payload.

- [x] Identita macchina Payload dedicata creata e conservata in GPG.
- [x] Vecchi segreti Payload e password amministratore ruotati dopo
  l'incidente di esposizione durante la verifica; i valori precedenti sono
  rifiutati.
- [x] Installati i tool `foolish_cms_collections`, `foolish_cms_list`,
  `foolish_cms_get`, `foolish_cms_create`, `foolish_cms_update`,
  `foolish_cms_delete` e `foolish_cms_media_upload`.
- [x] Alfred registra 61 tool: i 54 precedenti più i sette nuovi, senza perdita
  delle funzioni Stripe, ordini, Packlink, fatturazione o comunicazione.
- [x] Scritture protette da anteprima e conferma; cancellazioni protette anche
  dalla stringa esatta `DELETE <collection> <record-id>`.
- [x] Audit JSONL privo di valori sensibili, con permessi filesystem `0600`.
- [x] Smoke test reale completato su cliente, immagine e prodotto inattivo;
  verificate modifiche localizzate in italiano, inglese, tedesco, francese e
  spagnolo.
- [x] Anteprima di una modifica ordine verificata senza effettuare la scrittura.
- [x] Tutti i record temporanei eliminati e assenza residui verificata via API.
- [x] Backup di rollback conservato in
  `/home/nanobot-admin/.nanobot/rollback/20260816-alfred-full-cms`.

## Fase 1 — Aggiornamento dipendenze

Obiettivo: eliminare o documentare le vulnerabilità dirette senza introdurre
regressioni nei tre servizi.

### Baseline audit del 2026-08-15

| Applicazione | Totale | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: |
| CMS | 24 | 19 | 5 | 0 |
| Storefront | 19 | 15 | 3 | 1 |
| B2B | 5 | 4 | 1 | 0 |

Dipendenze dirette principali segnalate:

- CMS: Payload, pacchetti Payload, Next.js e Sharp.
- Storefront: Next.js e `@payloadcms/richtext-lexical`.
- B2B: Next.js e `@tailwindcss/postcss`.

### Strategia

- [x] Salvare il dettaglio degli advisory e distinguere dipendenze dirette,
  transitive e codice realmente raggiungibile.
- [x] Preparare tre write-set separati: CMS, Storefront e B2B.
- [x] Aggiornare insieme tutti i pacchetti Payload alla stessa versione.
- [x] Aggiornare Next.js e verificare eventuali breaking change.
- [x] Aggiornare Sharp e validare build e gestione immagini.
- [x] Rigenerare i lockfile senza riferimenti a registry non autorizzati.
- [x] Documentare gli advisory che non possono essere risolti subito.
- [x] CMS: allineare i manifest alla versione Payload realmente risolta dal
  lockfile prima dell'upgrade.
- [x] CMS: eliminare la compatibilità legacy e verificare il lockfile con
  `npm ci --strict-peer-deps --include=optional`.
- [x] B2B: modificare il Dockerfile affinché copi il lockfile ed esegua
  `npm ci` invece di `npm install`.
- [x] B2B: verificare ed eliminare eventuali riferimenti a mirror npm non
  autorizzati nel lockfile.

### Audit dopo l'upgrade del 2026-08-16

| Applicazione | Totale | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: |
| CMS | 7 | 0 | 6 | 1 |
| Storefront | 0 | 0 | 0 | 0 |
| B2B | 0 | 0 | 0 | 0 |

Le sette segnalazioni CMS residue sono transitive: sei moderate nella toolchain
Drizzle/esbuild e una low nella catena Monaco/DOMPurify. `npm audit` non indica
un fix compatibile per la catena Drizzle; nessuna è high o critical. Lo
Storefront non usava `@payloadcms/richtext-lexical`: la dipendenza è stata
rimossa invece di portare Payload nel runtime pubblico senza necessità.

Debiti separati emersi durante la verifica:

- il lint Storefront ha 45 errori preesistenti sia con
  `eslint-config-next` 16.2.4 sia con 16.3.1; typecheck e build restano verdi;
- alcuni pacchetti React Email sono deprecati e richiedono un write-set
  dedicato con verifica dei template transazionali;
- `admin.thefoolishbutcher.com` non risolve e non è configurato come custom
  domain Railway; il CMS operativo usa il dominio Railway assegnato;
- il Dockerfile Storefront copia ancora l'intero `node_modules`; è corretto ma
  produce un'immagine più grande dell'output standalone.

### Verifiche locali

CMS:

```sh
cd cms
npm ci
npm run generate:types
npm run build
```

Storefront:

```sh
cd storefront
npm ci
npm run lint
npm run build
```

B2B:

```sh
cd b2b
npm ci
npm run build
```

Per tutti:

- [x] `npm audit --omit=dev` rieseguito e risultato registrato.
- [x] Build Docker equivalente a produzione riuscita.
- [x] Login e pagine protette verificate.
- [x] Lettura prodotti e media verificata.
- [~] Pagine checkout verificate senza addebiti; la prova automatizzata di
  creazione ordine end-to-end resta nella Fase 3.
- [x] Webhook Stripe e riconciliazione verificati: esecuzione reale riuscita,
  zero ordini mancanti e zero errori.

### Distribuzione

- [x] Distribuire prima il CMS e monitorarlo.
- [x] Distribuire Storefront solo dopo la verifica del CMS.
- [x] Distribuire B2B per ultimo.
- [x] Registrare commit, deployment ID, esito e rollback per ogni servizio.

### Criterio di chiusura

Le vulnerabilità high dirette sono eliminate; installazioni pulite, build
applicative, build Docker e smoke test di produzione passano. I deployment
precedenti restano disponibili in Railway come rollback.

## Fase 2 — Tunnel Alfred direttamente sulla Raspberry

Obiettivo: `alfred.thefoolishbutcher.com` deve funzionare anche con il computer
di sviluppo spento.

### Stato attuale

Il percorso pubblico attivo è:

```text
Cloudflare sulla Raspberry -> 127.0.0.1:18790 -> Alfred
```

`cloudflared-alfred.service` e `alfred-pi-forward.service` sul computer sono
fermi e disabilitati. I relativi file restano disponibili come rollback, ma il
computer non è più nel percorso di produzione.

### Attività

- [x] Verificare risorse, architettura ARM e spazio disponibile sulla Raspberry.
- [x] Installare `cloudflared` sulla Raspberry con pacchetto e configurazione
  compatibili.
- [x] Creare un servizio utente o di sistema con restart automatico.
- [x] Collegare il tunnel direttamente a `127.0.0.1:18790` sulla Raspberry.
- [x] Conservare il tunnel corrente come rollback durante la migrazione.
- [x] Verificare endpoint pubblico e firma HMAC.
- [x] Verificare notifica Telegram generata da un heartbeat reale.
- [!] Riavviare la Raspberry e verificare il ripristino automatico: il comando
  richiede autenticazione amministrativa interattiva non disponibile alla
  sessione remota.
- [x] Provare il percorso pubblico con il computer spento o isolato.
- [x] Disattivare `alfred-pi-forward.service` e
  `cloudflared-alfred.service` sul computer solo dopo tutti i test.

### Evidenze operative

- Raspberry `aarch64`, Debian 13, 20 GB disponibili e uscita Cloudflare 443
  verificata.
- `cloudflared` 2026.8.2 ARM64 scaricato dalla release ufficiale e verificato
  con SHA-256; configurazione e credenziale tunnel hanno permessi `0600`.
- Servizio utente abilitato con linger e restart automatico; quattro connessioni
  QUIC registrate tra Roma e Milano.
- Riavvio simultaneo di Alfred e cloudflared superato: origine tornata
  raggiungibile, 61 tool registrati e `/health` pubblico HTTP 200.
- Con entrambi i servizi locali del computer fermi e disabilitati, un heartbeat
  HMAC reale è arrivato ad Alfred ed è stato instradato fuori dalla pipeline
  ordine; nessun canale di allarme ha riportato errori.

### Rollback

Se la replica sulla Raspberry fallisce, fermare
`cloudflared-alfred.service` sulla Pi e riabilitare temporaneamente sul computer
prima `alfred-pi-forward.service` e poi `cloudflared-alfred.service`. I file del
vecchio percorso non sono stati eliminati. Il backup remoto è in
`/home/nanobot-admin/.nanobot/rollback/20260816-cloudflared-pi`.

### Criterio di chiusura

Alfred è raggiungibile pubblicamente dopo un reboot della Raspberry e con il
computer spento; il vecchio ponte è disattivato e il rollback è documentato.

## Fase 3 — Affidabilità e osservabilità ordini

Obiettivo: nessun pagamento deve restare senza ordine e ogni anomalia deve
essere rilevata entro 15 minuti.

### Protezioni già presenti

- [x] Webhook fail-loud.
- [x] Persistenza idempotente.
- [x] Riconciliazione ogni 15 minuti.
- [x] Audit giornaliero di 365 giorni.
- [x] Allarmi Alfred e Resend.

### Attività completate

- [x] Aggiungere test automatici per evento Stripe duplicato.
- [x] Aggiungere test per eventi fuori ordine.
- [x] Aggiungere test per CMS temporaneamente irraggiungibile.
- [x] Verificare che un webhook fallito venga recuperato dalla riconciliazione.
- [x] Verificare che un pagamento senza ordine generi allarme entro 15 minuti.
- [x] Eseguire una prova periodica reale dei due canali di allarme.
- [x] Scrivere una procedura operativa per recuperare un ordine da PaymentIntent
  o Checkout Session senza modificare direttamente il database.
- [x] Registrare giornalmente i conteggi pagamenti Stripe e ordini CMS.

### Evidenze di chiusura

- `npm run test:orders` copre cinque casi: sessione duplicata, corsa tra webhook
  e riconciliatore, CMS temporaneamente indisponibile, esaurimento dei quattro
  tentativi e recupero di una sessione pagata il cui webhook è stato perso.
- Il servizio Railway `cron-stripe-reconcile` usa `*/15 * * * *`; il servizio
  `cron-stripe-audit-daily` usa `15 4 * * *`, una finestra di 365 giorni e
  `heartbeat=1`. Gli ultimi deployment di entrambi risultano `SUCCESS`.
- Un heartbeat reale ha restituito HTTP 200 con un ordine già presente e zero
  errori. Nei log Storefront non risultano fallimenti di alcun canale; Alfred ha
  registrato l'evento come riconciliazione senza avviare la pipeline ordine.
- Il routing Alfred distingue ora heartbeat, audit e fatal reconciliation dagli
  ordini. La suite Raspberry passa 22 test e il servizio risulta attivo.
- La procedura ripetibile è in `docs/stripe-order-recovery.md` e vieta la
  modifica diretta del database.

### Casi di prova minimi

| Caso | Risultato atteso |
| --- | --- |
| Evento duplicato | Un solo ordine CMS |
| Webhook ritentato | Stesso ordine, nessun duplicato |
| CMS non disponibile | Webhook fallisce e Stripe ritenta |
| Webhook definitivamente perso | Riconciliazione crea l'ordine |
| Pagamento senza ordine da oltre 15 minuti | Allarme Alfred e Resend |
| Audit giornaliero | Conteggi e differenze espliciti |

### Criterio di chiusura

Tutti i casi di prova sono automatizzati o accompagnati da una procedura
ripetibile, e l'allarme entro 15 minuti è stato osservato realmente.

## Fase 4 — PEC e storia Git

Stato: rinviata per decisione esplicita del proprietario, che cambierà provider
a breve.

### Vincoli attuali

- [!] Non cambiare password, SMTP o configurazione SuperPEC.
- [!] Non rimuovere la credenziale PEC dai runtime che ne hanno ancora bisogno.
- [!] Non riscrivere la storia Git durante questa fase di attesa.

La credenziale PEC corrente compare nella storia di due commit. La rotazione di
CMS e Umami rende innocue le rispettive vecchie copie, ma la PEC resta esposta
finché non viene revocata o sostituita.

### Attività dopo l'autorizzazione

- [ ] Configurare il nuovo provider e verificare invio e ricezione.
- [ ] Verificare fatturazione elettronica, notifiche e allegati.
- [ ] Aggiornare Alfred con la nuova configurazione.
- [ ] Revocare la vecchia credenziale SuperPEC.
- [ ] Rimuovere la vecchia configurazione dai runtime.
- [ ] Verificare eventuali clone del repository contenenti la vecchia storia.
- [ ] Decidere se la riscrittura della storia Git offre un beneficio sufficiente
  rispetto al costo operativo e al force-push.

### Criterio di chiusura

Il vecchio servizio è revocato, nessun runtime usa la vecchia credenziale e la
decisione sulla storia Git è documentata.

## Procedura di aggiornamento di questo documento

Per ogni sessione di lavoro:

1. Leggere interamente questo file prima di modificare codice o infrastruttura.
2. Scegliere una sola fase come obiettivo principale.
3. Aggiornare lo stato sintetico e marcare `[~]` le attività iniziate.
4. Applicare modifiche piccole e verificabili.
5. Registrare prove, commit e deploy nel registro seguente.
6. Marcare `[x]` solo dopo il superamento del criterio di chiusura.
7. Aggiornare "Prossima azione" prima di terminare la sessione.

## Registro avanzamento

Usare una riga per ogni modifica o verifica rilevante. Non inserire segreti,
token, email private o dati cliente.

| Data | Fase | Modifica o verifica | Evidenza | Esito | Prossimo passo |
| --- | --- | --- | --- | --- | --- |
| 2026-08-15 | Baseline | Recuperati due ordini Stripe mancanti | CMS 25 e 26 | Superato | Mantenere audit giornaliero |
| 2026-08-15 | Baseline | Audit Stripe/CMS di 365 giorni | 22 pagamenti / 22 ordini | Superato | Test regressione automatici |
| 2026-08-15 | Baseline | Rotazione CMS e Umami | Vecchie password 401, nuove 200 | Superato | Fase 0 |
| 2026-08-15 | Fase 2 | Forward Alfred spostato su Tailscale | Endpoint pubblico raggiunge Alfred | Superato | Tunnel diretto sulla Raspberry |
| 2026-08-15 | Fase 0 | Confrontati runtime Frank e Alfred | Alfred ha gli strumenti Foolish; i cron operativi sono ancora su Frank | Da migrare | Classificare e trasferire i cron Foolish |
| 2026-08-16 | Fase 0 | Audit auth Alfred/Payload | Letture macchina; update ordini ancora con password admin | In correzione | Endpoint ordini dedicato |
| 2026-08-16 | Fase 0 | Endpoint ordini Alfred preparato | Segreto dedicato cifrato; allowlist server-side di cinque campi; build CMS superata | Da distribuire | Deploy CMS e smoke test |
| 2026-08-16 | Fase 0 | Endpoint ordini Alfred distribuito | CMS deployment `d4fa1588`; 401 senza/secret errato, 400 campo vietato, 200 no-op autorizzato | Superato | Migrare runtime Alfred |
| 2026-08-16 | Fase 0 | Runtime e cron migrati ad Alfred | Tool read/update reali superati; analytics, Packlink e Brevo eseguiti dal cron; baseline Brevo valida | Superato | Spegnere Frank |
| 2026-08-16 | Fase 0 | Frank ritirato | `frank.service` inactive e disabled; quattro cron Foolish disabilitati; stato conservato senza password admin | Superato | Chiudere credenziali Storefront |
| 2026-08-16 | Fase 0 | File credenziali temporaneo eliminato | Admin già in GPG; Printful e machine secret attivi cifrati e verificati; copia Payload obsoleta scartata | Superato | Ricerca finale |
| 2026-08-16 | Fase 0 | Upload foto recensioni senza login admin | Route usa il machine secret Media; typecheck, build e controllo accessi CMS superati | Da distribuire | Deploy Storefront e rimozione env admin |
| 2026-08-16 | Fase 0 | Upload recensioni distribuito e Fase 0 chiusa | Storefront deployment `ba64ffc7`; upload reale 200 e media test rimossa; nessuna variabile admin nei servizi Railway o runtime attivi | Superato | Fase 1 dipendenze |
| 2026-08-16 | Fase 0 | Alfred abilitato all'amministrazione CMS completa | 61 tool registrati; permessi CRUD su tutte le collezioni; cliente/media/prodotto e cinque locale verificati; audit `0600`; nessun residuo | Superato | Fase 1 dipendenze |
| 2026-08-16 | Fase 0 | Rotazione credenziali dopo esposizione durante verifica | Vecchi valori rifiutati; CMS deployment `4e90dac3`; Storefront deployment `e9490d85`; chiave SSH temporanea rimossa | Superato | Conservare solo bundle GPG e credenziali runtime |
| 2026-08-16 | Fase 1 | Audit dipendenze e lockfile | Tre write-set definiti; Docker B2B non riproducibile | Pianificato | Eseguire dopo la Fase 0 |
| 2026-08-16 | Fase 1 | CMS aggiornato e verificato | Commit `1865cbd`; deployment `049f483e`; Payload 3.88, Next 16.3.1 e Sharp 0.35.3; audit high 19→0; CRUD Alfred post-deploy superato | Superato | Storefront |
| 2026-08-16 | Fase 1 | Storefront aggiornato e verificato | Commit `d9aaee2`; deployment `e147ae3b`; audit 19→0; build, pagine, prodotto e riconciliazione reali superati | Superato | B2B |
| 2026-08-16 | Fase 1 | B2B aggiornato e verificato | Commit `31a34e5`; deployment `58c5afca`; audit 5→0; `npm ci`; contesto Docker 922 MB→539 KB; pagine/API superate | Superato | Fase 3 affidabilità ordini |
| 2026-08-16 | Fase 3 | Test automatici affidabilità ordine | Commit `6327990`; cinque test: duplicato, race, retry temporaneo, errore permanente e webhook perso; typecheck, build e audit puliti | Superato | Monitorare in produzione |
| 2026-08-16 | Fase 3 | Cron e allarmi verificati realmente | Riconciliazione ogni 15 minuti; audit giornaliero; heartbeat HTTP 200; zero errori canale nei log; evento ricevuto da Alfred | Superato | Mantenere heartbeat giornaliero |
| 2026-08-16 | Fase 3 | Routing eventi operativi Alfred corretto | Heartbeat instradato fuori dalla pipeline ordine; 22 test Raspberry; servizio attivo; job e nota di test errati rimossi con backup | Superato | Monitorare i successivi audit |
| 2026-08-16 | Fase 3 | Runbook recupero ordine aggiunto | `docs/stripe-order-recovery.md`; recupero idempotente da PaymentIntent o Checkout Session, senza SQL diretto | Superato | Usare la procedura per ogni incidente |
| 2026-08-16 | Fase 3 | Storefront distribuito e riconciliato | Deployment `2b40f34d` riuscito; home, checkout e robots 200; cron anonimo 401; audit 365 giorni: 40 sessioni, 22 pagamenti idonei, 22 ordini presenti, zero errori | Superato | Fase 2 tunnel Alfred |
| 2026-08-16 | Fase 2 | Tunnel Alfred migrato sulla Raspberry | `cloudflared` ARM64 verificato; quattro connessioni QUIC; health 200 e heartbeat HMAC ricevuto con ponte locale disabilitato | Superato | Reboot completo della Pi |
| 2026-08-16 | Fase 2 | Autoripartenza servizi verificata | Restart simultaneo Alfred/tunnel; 61 tool, origine e quattro connessioni ripristinati; linger attivo | Superato | Reboot completo della Pi |
| 2026-08-16 | Fase 2 | Reboot completo richiesto | `systemctl reboot` rifiutato perché richiede autenticazione amministrativa interattiva | Attesa operatore | Eseguire reboot direttamente sulla Pi |
| 2026-08-16 | Infrastruttura | Dominio CMS documentato ma assente | `admin.thefoolishbutcher.com` NXDOMAIN; nessun custom domain Railway; endpoint Railway e Alfred operativi | Da correggere | Ripristinare DNS/custom domain o aggiornare la documentazione |

## Prossima azione concordata

Eseguire un reboot amministrativo completo della Raspberry e verificare il
ritorno automatico di Alfred e del tunnel. Poi mantenere dominio CMS, lint
Storefront e React Email come write-set separati.
