# Abbonamento Pelle Mensile — Design Spec

**Data:** 2026-07-15
**Scope:** `foolish-storefront/storefront/` + `foolish-storefront/cms/`
**Obiettivo:** Sistema di abbonamento mensile a due prodotti fissi (foglio pratica Tattoo XXL, set 3 visi PMU) con benefici di spedizione/prezzo crescenti nel tempo, per abbattere l'attrito del riacquisto ricorrente e il peso della spedizione.

---

## Prodotti in abbonamento

Due referenze fisse, nessuna variante scelta dal cliente:

- **Tattoo XXL** — foglio pratica tattoo, 45€
- **PMU 3 visi** — set pratica permanent makeup, 67,50€ (spedizione IT già gratuita di default sopra i 50€)

Zone supportate al lancio: **Italia** ed **Europa** (`shipping.ts`). Il resto del mondo non è supportato: il flusso di iscrizione blocca la selezione con un messaggio "non ancora disponibile per questa destinazione".

---

## Griglia benefici

| | Mese 1 | Mese 2–5 | Mese 6+ |
|---|---|---|---|
| **Tattoo IT** | 45€ + 7,65€ sped. | 45€, spedizione gratis | 40,50€ (-10%), spedizione gratis |
| **Tattoo EU** | 45€ + 14,99€ sped. | 45€ + sped. + **foglio omaggio** | 40,50€ (-10%) + sped. + foglio omaggio |
| **PMU IT** | 67,50€ (sped. già gratis) | 60,75€ (-10%) | 60,75€ (-10%, non cumulativo) + **4° viso omaggio** |
| **PMU EU** | 67,50€ + sped. | 67,50€ + sped. + **4° viso omaggio** | 60,75€ (-10%) + sped. + 4° viso omaggio |

Regole generali:
- Il -10% non è cumulativo con altre percentuali: è un tetto fisso dal ciclo 6 in poi.
- Il foglio/viso omaggio è un beneficio di **fulfillment** (cosa va nel pacco), non incide sul prezzo fatturato.
- Cancellazione libera in ogni momento. Riattivando l'abbonamento in futuro, si riparte sempre dal ciclo 1 (nessuno storico mantenuto).

---

## Architettura prezzi (Stripe)

Ogni combinazione **prodotto × zona** (Tattoo-IT, Tattoo-EU, PMU-IT, PMU-EU) è una **Stripe Subscription Schedule a 3 fasi**:

1. **Fase 1** (1 ciclo): prezzo pieno prodotto + spedizione dove dovuta
2. **Fase 2** (cicli 2–5): prezzo senza spedizione (IT) o invariato (EU — la spedizione resta fatturata, il compenso è il foglio/viso omaggio in fulfillment)
3. **Fase 3** (dal ciclo 6, indefinita): -10% sul prezzo prodotto, spedizione come da fase 2

Stripe gestisce autonomamente la transizione tra fasi ad ogni rinnovo — nessuna logica custom di calcolo prezzo lato nostro codice. Il foglio/viso omaggio non è un item Stripe: è un flag calcolato dal nostro webhook (zona + numero ciclo) al momento della creazione dell'Order CMS.

---

## Modello dati — CMS

Nuova collection **`Subscriptions`** (`cms/src/collections/Subscriptions.ts`), pattern simile a `ProMembers`/`PromoCodes`:

- `customer` — relationship a `Customers`
- `product` — select: `tattoo` / `pmu`
- `zone` — select: `IT` / `EU`
- `stripeSubscriptionId`, `stripeScheduleId` — text, unique
- `status` — select: `active` / `canceled`
- `cyclesCompleted` — number, readOnly (calcolato dai webhook)
- `startedAt`, `canceledAt` — date

È la fonte di verità sia per il webhook (calcolo bonus/fase) sia per la UI account. Un cliente può avere fino a due subscription attive in parallelo (Tattoo + PMU), record indipendenti.

---

## Flusso di iscrizione e rinnovo

**Iscrizione:** dalla pagina prodotto dell'abbonamento (vedi sezione Landing), il cliente conferma il paese di spedizione (limitato a IT + lista `EU_COUNTRIES` di `shipping.ts`). Si apre una Stripe Checkout Session in `mode: 'subscription'` agganciata allo schedule prodotto/zona corretto. Al completamento, creiamo il record `Subscriptions` (ciclo 1, `active`).

**Rinnovo:** nuovo handler nel webhook esistente (`storefront/src/app/api/webhook/stripe/route.ts`) per l'evento `invoice.payment_succeeded` con `subscription` valorizzato:
1. Incrementa `cyclesCompleted` sul record `Subscriptions` corrispondente
2. Calcola se il ciclo ha diritto a foglio/viso omaggio (EU sempre da ciclo 2; PMU IT da ciclo 6)
3. Crea un **Order** CMS identico a un ordine normale, con `origin: 'subscription'` e una riga aggiuntiva per l'omaggio quando previsto — stesso magazzino, stesso processo di evasione degli ordini normali

**Pagamento fallito:** retry gestiti dal dunning di default di Stripe. Se la subscription arriva a `canceled` per mancato pagamento (`customer.subscription.deleted`), trattata come cancellazione volontaria: status `canceled`, futura riattivazione riparte dal ciclo 1.

**Cambio zona a metà abbonamento:** se il cliente aggiorna l'indirizzo di spedizione in account e la zona cambia (IT↔EU), lo Stripe Subscription Schedule viene aggiornato per riflettere la nuova zona **dal rinnovo successivo**. Il `cyclesCompleted` maturato resta acquisito — cambia solo il trattamento spedizione/omaggio da quel punto in poi.

---

## Landing pages

Struttura a hub + pagine prodotto dedicate, localizzate sui 5 locali (`it`, `en`, `de`, `fr`, `es`):

- **`/[locale]/abbonamento`** — hub: hero breve + due card (Tattoo XXL / PMU 3 visi) che rimandano alle pagine dedicate
- **`/[locale]/abbonamento/tattoo`** e **`/[locale]/abbonamento/pmu`** — pagine prodotto complete: foto e descrizione del prodotto (stile pagina prodotto esistente `/[locale]/prodotto/[slug]`), poi la sezione **roadmap benefici**, poi CTA "Abbonati" → Stripe Checkout
- **CTA in home** — sezione/banner che rimanda all'hub `/abbonamento`

### Sezione roadmap (componente riutilizzabile)

Layout a **roadmap orizzontale**: linea temporale unica con tre tappe (ciclo 1 / ciclo 2 / ciclo 6), ciascuna con numero grande in Cormorant Garamond italic (coerente con `.font-display`/`.stat-number` di `globals.css`), titolo tappa e prezzo (font mono, come da convenzione `.text-mono` per i prezzi). Stile brand: sfondo `#080808`, accento `#c8a97e`, ink-line dorata come separatore.

Sopra la roadmap, **due tab selezionabili "Italia" / "Europa"** che sostituiscono il contenuto dei tre nodi con i valori della zona scelta (nessun redirect, nessuna doppia roadmap sempre visibile — swap di contenuto in-place).

---

## Account UI

Nuova sezione **`/[locale]/account/abbonamento`**, che mostra per ogni subscription attiva del cliente:
- prodotto, ciclo corrente, prezzo del mese in corso
- prossimo traguardo ("tra 3 mesi sblocchi il -10%" / "dal prossimo mese spedizione gratis")
- pulsante **Cancella** → nuova API route che cancella la Stripe Subscription **a fine periodo corrente** (il cliente non perde il mese già pagato) e aggiorna `status: canceled` sul record CMS

Il cambio del metodo di pagamento resta delegato al portale self-service Stripe (link esterno), non costruiamo una UI dedicata per quello.

---

## Testing

Stripe in modalità test con [test clock](https://stripe.com/docs/billing/testing/test-clocks) per simulare il passaggio dei cicli (1 → 2 → 6) senza attendere mesi reali, verificando ad ogni fase: transizione corretta dello schedule, webhook ricevuto, Order CMS generato con riga omaggio quando prevista, aggiornamento corretto di `cyclesCompleted`.

---

## Fuori scope (per questo lancio)

- Zona WORLD (resto del mondo)
- Scelta di formato/variante del prodotto in abbonamento (referenza fissa)
- UI dedicata per cambio metodo di pagamento (si usa il portale Stripe)
- Possibilità di skip/pausa di un singolo ciclo senza cancellare l'intero abbonamento
