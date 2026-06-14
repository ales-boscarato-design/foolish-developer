# Design: Telefono obbligatorio e codici sconto flessibili

**Data:** 2026-06-14  
**Stato:** Approvato

---

## Obiettivi

1. Raccogliere il numero di telefono del cliente come campo obbligatorio in fase di acquisto e salvarlo sull'ordine nel CMS.
2. Permettere la creazione libera di codici sconto (percentuale o importo fisso) con data di scadenza, direttamente dal pannello CMS.

---

## Feature 1: Telefono obbligatorio al checkout

### Flusso attuale

Il form storefront raccoglie: nome, email, indirizzo, città, CAP, nazione. Nessun telefono. Il dato non viene né passato a Stripe né salvato nel CMS.

### Flusso nuovo

1. Il cliente compila il campo `phone` nel form storefront (required).
2. Il frontend valida il formato (minimo 6 cifre, accetta `+` e spazi).
3. Il campo viene inviato al body di `POST /api/stripe/checkout` insieme agli altri dati.
4. La route checkout inserisce `customer_phone` nei metadata della sessione Stripe.
5. Il webhook Stripe estrae `customer_phone` dai metadata e lo passa a `createOrderInCMS`.
6. L'ordine viene salvato nel CMS con il campo `customerPhone`.

### Modifiche

| File | Modifica |
|---|---|
| `storefront/src/app/[locale]/checkout/page.tsx` | Aggiunge `phone` al form state; aggiunge input UI required con validazione; include `phone` nel body della chiamata API |
| `storefront/src/app/api/stripe/checkout/route.ts` | Accetta `phone` dal body request; aggiunge `customer_phone: phone` a `metadata` della sessione Stripe |
| `storefront/src/app/api/webhook/stripe/route.ts` | Estrae `session.metadata.customer_phone`; passa il valore a `createOrderInCMS` |
| `cms/src/collections/Orders.ts` | Aggiunge campo `customerPhone` (type: text, opzionale — per compatibilità con ordini storici privi di telefono) |

### Note

- Il telefono è raccolto nel form storefront (prima del redirect a Stripe), non tramite `phone_number_collection` di Stripe. Consistente con l'approccio attuale per nome, email e indirizzo.
- Il campo è `opzionale` nel CMS per non rompere ordini storici e ordini manuali.

---

## Feature 2: Codici sconto flessibili

### Situazione attuale

`cms/src/collections/PromoCodes.ts` ha due tipi:
- `free_shipping`: spedizione gratuita
- `percent_pro`: sconto 15%/20% con logica hardcoded per Pro Members

Non è possibile creare codici con percentuale o importo personalizzato.

### Soluzione

#### CMS — `PromoCodes.ts`

Nuovi campi aggiunti alla collection:

| Campo | Tipo | Condizione | Descrizione |
|---|---|---|---|
| `type` | select | — | Aggiunge opzioni `percent` e `amount` alle esistenti |
| `discountPercent` | number | solo se `type === 'percent'` | Percentuale sconto (es. 20 per 20%) |
| `discountAmount` | number | solo se `type === 'amount'` | Importo sconto in euro (es. 15.00) |
| `expiresAt` | date | opzionale, tutti i tipi | Data di scadenza del codice |

I tipi esistenti `free_shipping` e `percent_pro` restano invariati.

#### Storefront — `/api/promo/validate/route.ts`

Logica aggiuntiva (eseguita dopo i check esistenti):

1. **Scadenza:** se `expiresAt` è impostata e la data è passata → `{ valid: false, reason: 'expired' }`
2. **Tipo `percent`:** → `{ valid: true, type: 'percent', discountPercent: code.discountPercent }`
3. **Tipo `amount`:** → `{ valid: true, type: 'amount', discountAmount: code.discountAmount }`

Il check di scadenza si applica anche ai tipi esistenti (`free_shipping`, `percent_pro`).

#### Storefront — `checkout/page.tsx`

Verificare che l'UI mostri correttamente lo sconto fisso in euro (€X off) oltre alla percentuale già gestita. Se necessario, aggiungere il caso `type === 'amount'` nella logica di display.

#### Storefront — `/api/stripe/checkout/route.ts`

Lo sconto è già gestito come line item negativo con valore assoluto (`discountAmount`). Funziona sia per sconti percentuali (calcolati lato client prima dell'invio) sia per importi fissi. Nessuna modifica necessaria salvo verifica.

---

## Fuori scope

- Limite massimo di utilizzi per codice (`maxUses`) — da valutare in futuro
- Codici monouso legati a cliente specifico — già gestiti dai Customer Offers esistenti
- Integrazione con Stripe Coupons — non necessaria, lo sconto è gestito come line item negativo

---

## Ordine di implementazione

1. CMS: aggiunta campo `customerPhone` a Orders
2. CMS: aggiornamento PromoCodes (nuovi tipi + campi condizionali + `expiresAt`)
3. Storefront: form checkout (campo phone + validazione)
4. Storefront: `/api/stripe/checkout` (passa phone in metadata)
5. Storefront: `/api/webhook/stripe` (estrae phone, salva in CMS)
6. Storefront: `/api/promo/validate` (nuovi tipi + check scadenza)
7. Storefront: `checkout/page.tsx` (verifica display sconto fisso)
8. Typecheck completo + deploy
