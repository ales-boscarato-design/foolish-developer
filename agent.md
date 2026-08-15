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
| 0. Credenziali e separazione | Completata | Mantenere il controllo durante le fasi successive |
| 1. Dipendenze | Audit completato | Applicare i tre write-set separati dopo la Fase 0 |
| 2. Tunnel Alfred | Da fare | Preparare `cloudflared` direttamente sulla Raspberry |
| 3. Affidabilità ordini | Parzialmente completata | Aggiungere test di regressione e prova allarmi |
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
- [ ] Aggiornare insieme tutti i pacchetti Payload alla stessa versione.
- [ ] Aggiornare Next.js e verificare eventuali breaking change.
- [ ] Aggiornare Sharp e validare build e gestione immagini.
- [ ] Rigenerare il lockfile senza aggiornamenti estranei.
- [ ] Documentare gli advisory che non possono essere risolti subito.
- [ ] CMS: allineare i manifest alla versione Payload realmente risolta dal
  lockfile prima dell'upgrade.
- [ ] CMS: usare `npm ci --legacy-peer-deps --include=optional` finché il
  lockfile non è stato rigenerato e verificato senza compatibilità legacy.
- [ ] B2B: modificare il Dockerfile affinché copi il lockfile ed esegua
  `npm ci` invece di `npm install`.
- [ ] B2B: verificare ed eliminare eventuali riferimenti a mirror npm non
  autorizzati nel lockfile.

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

- [ ] `npm audit --omit=dev` rieseguito e risultato registrato.
- [ ] Build Docker equivalente a produzione riuscita.
- [ ] Login e pagine protette verificate.
- [ ] Lettura prodotti e media verificata.
- [ ] Checkout e creazione ordine verificati senza addebiti reali.
- [ ] Webhook Stripe e riconciliazione verificati.

### Distribuzione

- [ ] Distribuire prima il CMS e monitorarlo.
- [ ] Distribuire Storefront solo dopo la verifica del CMS.
- [ ] Distribuire B2B per ultimo.
- [ ] Registrare commit, deployment ID, esito e rollback per ogni servizio.

### Criterio di chiusura

Le vulnerabilità high dirette sono eliminate oppure motivate e accettate; tutti
i build e gli smoke test passano; ogni servizio dispone di rollback verificato.

## Fase 2 — Tunnel Alfred direttamente sulla Raspberry

Obiettivo: `alfred.thefoolishbutcher.com` deve funzionare anche con il computer
di sviluppo spento.

### Stato attuale

Il percorso pubblico dipende ancora da:

```text
Cloudflare sul computer -> forward SSH Tailscale -> Raspberry -> Alfred
```

Il forward usa ora Tailscale ed è operativo, ma il computer resta un punto
singolo di guasto.

### Attività

- [ ] Verificare risorse, architettura ARM e spazio disponibile sulla Raspberry.
- [ ] Installare `cloudflared` sulla Raspberry con pacchetto e configurazione
  compatibili.
- [ ] Creare un servizio utente o di sistema con restart automatico.
- [ ] Collegare il tunnel direttamente a `127.0.0.1:18791` sulla Raspberry.
- [ ] Conservare il tunnel corrente come rollback durante la migrazione.
- [ ] Verificare endpoint pubblico e firma HMAC.
- [ ] Verificare notifica Telegram generata da un heartbeat reale.
- [ ] Riavviare la Raspberry e verificare il ripristino automatico.
- [ ] Provare il percorso pubblico con il computer spento o isolato.
- [ ] Disattivare `alfred-pi-forward.service` e
  `cloudflared-alfred.service` sul computer solo dopo tutti i test.

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

### Attività residue

- [ ] Aggiungere test automatici per evento Stripe duplicato.
- [ ] Aggiungere test per eventi fuori ordine.
- [ ] Aggiungere test per CMS temporaneamente irraggiungibile.
- [ ] Verificare che un webhook fallito venga recuperato dalla riconciliazione.
- [ ] Verificare che un pagamento senza ordine generi allarme entro 15 minuti.
- [ ] Eseguire una prova periodica reale dei due canali di allarme.
- [ ] Scrivere una procedura operativa per recuperare un ordine da PaymentIntent
  o Checkout Session senza modificare direttamente il database.
- [ ] Registrare giornalmente i conteggi pagamenti Stripe e ordini CMS.

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
| 2026-08-16 | Fase 1 | Audit dipendenze e lockfile | Tre write-set definiti; Docker B2B non riproducibile | Pianificato | Eseguire dopo la Fase 0 |

## Prossima azione concordata

Iniziare la Fase 1 con il write-set CMS: allineare i pacchetti Payload, Next.js
e Sharp, rigenerare il lockfile, eseguire build e audit, quindi distribuire e
monitorare il CMS prima di modificare Storefront e B2B.
