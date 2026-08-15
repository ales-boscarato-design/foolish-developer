# SEBO — handoff attività residue

Aggiornato: 15/08/2026.

Questo documento sostituisce l'handoff del 28/07, che conteneva riferimenti a domini, account e attività ormai superati. La fonte editoriale completa resta `/home/ab/foolish_HM/SEBO/ROADMAP_LANCIO_SEBO.md`.

## Completato

- API key Payload abilitata e migrazione applicata.
- Integrazione Printful e galleria merch implementate.
- Link Instagram aggiornato a `sebo_practice_archives`.
- Pagina SEBO ridisegnata e riattivata nella navigazione.
- Campi SEO, copy collezione e lightbox prodotto implementati.
- Repository e deploy migrati su `ales-boscarato-design/foolish-developer`.
- Flusso ordini Stripe reso recuperabile e riconciliato automaticamente.

## Attività residue

### 7.2 — Contenuti prodotti merch

- Verificare nel CMS i dieci prodotti SEBO e lo stato attuale di nomi, descrizioni e immagini.
- Usare `/home/ab/foolish_HM/SEBO/FASE7_DESCRIZIONI_PRODOTTO.md` come fonte del copy.
- Confermare su Printful colore e `printfulSyncProductId` prima di modificare i nomi.
- Non attivare un prodotto senza almeno un'immagine reale collegata in Payload.
- Applicare gli aggiornamenti con API server-to-server (`PAYLOAD_API_SECRET`), mai con password personali hardcoded.
- Registrare nella roadmap il prima/dopo e l'approvazione editoriale.

### 8 — Verifica storefront

- Controllare `/it/sebo` e le altre quattro lingue.
- Verificare hero, bio, wall, sticker, merch, prezzi, immagini e CTA.
- Verificare layout mobile a 375 px.
- Eseguire un acquisto end-to-end controllato: checkout, pagamento, ordine Payload, email e fulfillment Printful.
- Non usare pagamenti reali o inviare ordini Printful senza approvazione esplicita.

### 9 — Go/no-go

- Verificare il percorso post Instagram → storefront → checkout → conferma.
- Preparare moderazione commenti/DM e promozione incrociata.
- Aggiungere e verificare gli UTM del lancio.
- Scrivere il rollback operativo per storefront, CMS e merch.
- Ottenere un go/no-go esplicito e aggiornare la data di lancio.

## Riferimenti correnti

- Storefront: `https://thefoolishbutcher.com`.
- CMS: `https://cms-production-1e56.up.railway.app`.
- Alfred: Raspberry Pi, staging/configurazione in `/home/ab/nano-py`.
- Repository: `ales-boscarato-design/foolish-developer`.
