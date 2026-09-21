import Stripe from 'stripe'
import {
  allocateProductDiscount,
  buildCheckoutMetadata,
  calculateServerShippingCostCents,
  normalizeCheckoutCustomer,
  normalizeCheckoutItems,
  type ChargedProductLine,
} from './promo'
import { isAllowedShippingCountry } from './shipping'

/**
 * Riordino dall'area account: dal documento ordine del CMS a una sessione Stripe
 * pagabile.
 *
 * Perche' esiste come modulo a se': il pulsante "Riordina" apriva una sessione con
 * le sole righe prodotto. Nessuna riga "Spedizione", nessun indirizzo raccolto,
 * nessun `items_json` nei metadata. Due conseguenze, entrambe sui soldi:
 *
 * 1. il cliente pagava 0,00 di trasporto su qualunque destinazione (anche dove il
 *    costo sdoganato e' di decine di euro);
 * 2. l'ordine registrato dal webhook nasceva con `shippingCost` = valore merce:
 *    il parser ricostruisce la spedizione dal residuo `amount_total - righe`, e
 *    senza righe il residuo e' l'intero totale. Fattura, bolla e dogana leggono
 *    quel campo.
 *
 * Qui la tariffa viene dalla stessa fonte del checkout
 * (`calculateServerShippingCostCents` -> `shipping.ts`) e la destinazione e' quella
 * reale dell'ordine di partenza. Ogni caso che non ha una misura di costo fallisce
 * chiuso: meglio rinunciare al riordino che incassare una spedizione che non paga
 * il trasporto.
 */

/** Nome della riga di spedizione: identico a quello del checkout. */
export const SHIPPING_LINE_NAME = 'Spedizione'

export type ReorderFailureReason =
  /** Documento ordine inutilizzabile (non e' un record, senza numero ordine). */
  | 'order_unusable'
  /** Righe prodotto assenti o non riconducibili a un carrello valido. */
  | 'items_missing'
  /** Nome o indirizzo non utilizzabili per i metadata dell'ordine. */
  | 'address_incomplete'
  /** Paese di destinazione assente o non servito. */
  | 'destination_unknown'
  /** Destinazione servita ma senza una misura di costo: si quota. */
  | 'quotation_required'
  /** Metadata oltre i limiti Stripe. */
  | 'order_too_large'

export interface ReorderPlan {
  /** Numero dell'ordine di partenza (finisce nei metadata come `reorder_from`). */
  sourceOrderNumber: string
  /** Riferimento del nuovo ordine, stessa forma del checkout. */
  orderRef: string
  customerEmail: string
  /** Paese di destinazione della tariffa addebitata (ISO a due lettere). */
  destinationCountry: string
  /** Importo incassato per la spedizione, in centesimi. */
  shippingCostCents: number
  chargedProductLines: ChargedProductLine[]
  /** Metadata di sessione: la stessa forma che legge il parser degli ordini. */
  metadata: Record<string, string>
}

export type ReorderResult =
  | { status: 'ok'; plan: ReorderPlan }
  | { status: 'failed'; reason: ReorderFailureReason }

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Righe CMS -> carrello del checkout. La conversione e' volutamente grezza: la
 * validazione (tipi, prezzi positivi, limiti, quantita') la fa
 * `normalizeCheckoutItems`, la stessa funzione che valida il carrello del
 * checkout. Una riga a prezzo zero (omaggi abbonamento) o senza SKU non e' un
 * carrello pagabile: meglio fermarsi.
 */
function toCartItems(lineItems: unknown): unknown[] | null {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return null
  return lineItems.map((item) => {
    const record = asRecord(item)
    if (!record) return null
    return {
      productName: record.name,
      variantLabel: record.variantLabel,
      price: record.unitPrice,
      quantity: record.quantity,
      sku: record.sku,
    }
  })
}

/** Paese di destinazione dell'ordine di partenza, normalizzato. */
export function sourceOrderCountry(order: unknown): string | null {
  const record = asRecord(order)
  const address = record ? asRecord(record.shippingAddress) : null
  const raw = nonEmptyString(address?.country)
  return raw ? raw.toUpperCase() : null
}

export function buildReorderPlan(args: {
  order: unknown
  accountEmail: string
  now: number
}): ReorderResult {
  const order = asRecord(args.order)
  const orderNumber = order ? nonEmptyString(order.orderNumber) : null
  if (!order || !orderNumber) return { status: 'failed', reason: 'order_unusable' }

  const cartItems = toCartItems(order.lineItems)
  const normalizedItems = cartItems ? normalizeCheckoutItems(cartItems) : null
  if (!normalizedItems) return { status: 'failed', reason: 'items_missing' }

  const country = sourceOrderCountry(order)
  if (!country || !isAllowedShippingCountry(country)) {
    return { status: 'failed', reason: 'destination_unknown' }
  }

  const address = asRecord(order.shippingAddress)
  const customer = normalizeCheckoutCustomer({
    email: args.accountEmail,
    name: order.customerName,
    country,
    address: address?.address1,
    city: address?.city,
    postalCode: address?.postalCode,
    // Payload restituisce `null` per un campo di testo vuoto, e
    // `normalizeCheckoutCustomer` rifiuta una stringa vuota ma accetta il campo
    // assente: senza questa normalizzazione ogni ordine senza telefono
    // diventerebbe non riordinabile.
    phone: nonEmptyString(order.customerPhone) ?? undefined,
  })
  if (!customer) return { status: 'failed', reason: 'address_incomplete' }

  // Stessa fonte di verita' del checkout. `null` significa "per questa
  // destinazione non esiste un prezzo da addebitare" (paese non misurato): si
  // quota, non si indovina. Nessuno sconto e nessuna spedizione gratuita: il
  // riordino non porta promo.
  const shippingCostCents = calculateServerShippingCostCents(normalizedItems, country, false)
  if (shippingCostCents === null) return { status: 'failed', reason: 'quotation_required' }

  const chargedProductLines = allocateProductDiscount(normalizedItems, 0)
  if (!chargedProductLines) return { status: 'failed', reason: 'items_missing' }

  const orderRef = `FOOLISH-${args.now}`
  const metadata = buildCheckoutMetadata({
    orderRef,
    customer,
    chargedProductLines,
    shippingCostCents,
  })
  if (!metadata) return { status: 'failed', reason: 'order_too_large' }

  return {
    status: 'ok',
    plan: {
      sourceOrderNumber: orderNumber,
      orderRef,
      customerEmail: customer.email,
      destinationCountry: country,
      shippingCostCents,
      chargedProductLines,
      metadata: { ...metadata, reorder_from: orderNumber },
    },
  }
}

/**
 * Parametri di `checkout.sessions.create`, letti dalla firma del metodo: il tipo
 * nominale `Stripe.Checkout.SessionCreateParams` non e' esportato dal build ESM che
 * questa app risolve, e ricopiare la forma a mano la farebbe divergere dal SDK.
 */
type CheckoutSessionCreateParams = NonNullable<
  Parameters<Stripe['checkout']['sessions']['create']>[0]
>
type CheckoutLineItem = NonNullable<CheckoutSessionCreateParams['line_items']>[number]
type StripeAllowedCountry = NonNullable<
  CheckoutSessionCreateParams['shipping_address_collection']
>['allowed_countries'][number]

/**
 * Parametri della sessione di riordino.
 *
 * - le righe prodotto sono esattamente quelle registrate in `items_json`: cosi'
 *   il residuo che il parser calcola (`amount_total - righe`) coincide al
 *   centesimo con la riga "Spedizione" incassata;
 * - la spedizione e' una riga esplicita, non un residuo;
 * - l'indirizzo viene raccolto e confermato, e il paese ammesso e' solo quello su
 *   cui la tariffa e' stata calcolata: Stripe non puo' far pagare una spedizione
 *   per una destinazione diversa da quella quotata.
 */
export function buildReorderCheckoutSessionParams(
  plan: ReorderPlan,
  urls: { successUrl: string; cancelUrl: string },
): CheckoutSessionCreateParams {
  const lineItems: CheckoutLineItem[] = [
    ...plan.chargedProductLines.map((line) => ({
      price_data: {
        currency: 'eur',
        unit_amount: line.unitAmountCents,
        product_data: {
          name: `${line.name} — ${line.variantLabel}`,
          metadata: { sku: line.sku },
        },
      },
      quantity: line.qty,
    })),
    ...(plan.shippingCostCents > 0
      ? [{
          price_data: {
            currency: 'eur',
            unit_amount: plan.shippingCostCents,
            product_data: { name: SHIPPING_LINE_NAME },
          },
          quantity: 1,
        }]
      : []),
  ]

  return {
    mode: 'payment',
    line_items: lineItems,
    customer_email: plan.customerEmail,
    billing_address_collection: 'auto',
    shipping_address_collection: {
      allowed_countries: [plan.destinationCountry as StripeAllowedCountry],
    },
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    metadata: plan.metadata,
  }
}
