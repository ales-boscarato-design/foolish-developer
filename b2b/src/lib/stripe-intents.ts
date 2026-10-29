import Stripe from 'stripe'

/**
 * Creazione della PaymentIntent di un ordine B2B.
 *
 * Sta in un modulo a parte perche' e' l'unico punto in cui le rotte parlano
 * con Stripe: la rotta passa il client vero, i test passano un client finto
 * che registra i parametri. Cosi' l'importo in centesimi, la valuta, i
 * metadata e la chiave di idempotenza si possono verificare senza rete.
 *
 * Il client reale usa `Stripe.createFetchHttpClient()` invece del client
 * http/https di default: ogni chiamata passa da `globalThis.fetch`, quindi
 * i test di rotta possono intercettarla con uno stub locale (e nessuna
 * richiesta puo' sfuggire verso api.stripe.com).
 */

export interface StripeIntentParams {
  amount: number
  currency: 'eur'
  metadata: Record<string, string>
  automatic_payment_methods: { enabled: true }
}

/**
 * La parte di PaymentIntent che decide l'invariante: id, segreto e stato.
 * `latest_charge` e' un oggetto solo se la retrieve lo espande.
 */
export interface StripePaymentIntent {
  id: string
  client_secret?: string | null
  status?: string
  paid?: boolean
  latest_charge?: { status?: string } | string | null
}

export interface StripeIntentDeps {
  paymentIntents: {
    create(
      params: StripeIntentParams,
      opts: { idempotencyKey: string },
    ): Promise<StripePaymentIntent>
    retrieve(
      id: string,
      params: { expand: string[] },
    ): Promise<StripePaymentIntent>
  }
}

export interface OrderPaymentIntentArgs {
  amountCents: number
  orderId: string | number
  orderNumber: string
  resellerEmail: string
}

export interface EnsureOrderPaymentIntentArgs extends OrderPaymentIntentArgs {
  /**
   * L'id gia' memorizzato sull'ordine CMS, se c'e'. Il chiamante lo legge dal
   * documento che ha gia' in mano: nessuna chiamata in piu' per saperlo.
   */
  existingIntentId: string | null
}

/**
 * L'esito dice al chiamante cosa e' successo, non solo il segreto:
 *  - created / reused: una sola intent pagabile, il cui segreto si puo'
 *    consegnare (dopo aver collegato l'id all'ordine);
 *  - already_paid: i soldi sono in volo o incassati, non si crea nulla.
 */
export type IntentOutcome =
  | { kind: 'created' | 'reused'; intentId: string; clientSecret: string | null }
  | { kind: 'already_paid' }

const REUSABLE_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
])

function paymentIntentParams(args: OrderPaymentIntentArgs): StripeIntentParams {
  return {
    amount: args.amountCents,
    currency: 'eur',
    metadata: {
      orderId: String(args.orderId),
      orderNumber: args.orderNumber,
      resellerEmail: args.resellerEmail,
    },
    automatic_payment_methods: { enabled: true },
  }
}

/**
 * `orderNumber` e' la chiave di idempotenza della prima generazione: un doppio
 * click sul pagamento non deve addebitare due volte lo stesso ordine.
 *
 * Resta esportata per i test dei parametri; la rotta usa
 * `ensureOrderPaymentIntent`, che prima di creare guarda l'id gia' sull'ordine.
 */
export async function createOrderPaymentIntent(
  args: OrderPaymentIntentArgs,
  deps: StripeIntentDeps,
): Promise<{ client_secret: string | null }> {
  const created = await deps.paymentIntents.create(paymentIntentParams(args), {
    idempotencyKey: args.orderNumber,
  })
  return { client_secret: created.client_secret ?? null }
}

/**
 * Un addebito solo per ordine, anche oltre la finestra di idempotenza Stripe.
 *
 * Stripe conserva le chiavi per almeno 24 ore e poi le puo' eliminare: oltre
 * quella finestra una `create` con la stessa chiave produrrebbe una seconda
 * PaymentIntent. Percio' la fonte di verita' non e' la chiave del provider ma
 * l'id memorizzato sull'ordine CMS:
 *
 *  - id presente e intent ancora pagabile -> si riusa, zero create;
 *  - id presente e soldi in volo/incassati -> `already_paid`, zero create;
 *  - id presente e intent annullata -> nuova intent solo se non c'e' un
 *    addebito riuscito, con una chiave diversa per generazione (riusare la
 *    chiave farebbe rigiocare da Stripe la intent annullata);
 *  - id assente -> prima generazione, chiave `orderNumber` come sempre.
 *
 * Qualunque stato sconosciuto e' fail-closed: non si crea una seconda intent.
 * Un errore di create/retrieve propaga, cosi' il chiamante risponde 502 e non
 * maschera un timeout ambiguo con una seconda intent "per sicurezza".
 */
export async function ensureOrderPaymentIntent(
  args: EnsureOrderPaymentIntentArgs,
  deps: StripeIntentDeps,
): Promise<IntentOutcome> {
  if (!args.existingIntentId) {
    const created = await deps.paymentIntents.create(paymentIntentParams(args), {
      idempotencyKey: args.orderNumber,
    })
    return { kind: 'created', intentId: created.id, clientSecret: created.client_secret ?? null }
  }

  const existing = await deps.paymentIntents.retrieve(args.existingIntentId, {
    expand: ['latest_charge'],
  })
  const status = existing.status

  if (status && REUSABLE_STATUSES.has(status)) {
    return { kind: 'reused', intentId: existing.id, clientSecret: existing.client_secret ?? null }
  }

  if (status === 'canceled') {
    if (chargeSucceeded(existing)) return { kind: 'already_paid' }
    const created = await deps.paymentIntents.create(paymentIntentParams(args), {
      // Chiave per generazione: la chiave della prima intent rigiocherebbe
      // la intent annullata, restituendo un segreto inutilizzabile.
      idempotencyKey: `${args.orderNumber}:after:${args.existingIntentId}`,
    })
    return { kind: 'created', intentId: created.id, clientSecret: created.client_secret ?? null }
  }

  // processing, requires_capture, succeeded e ogni stato non riconosciuto:
  // i soldi si stanno muovendo o sono incassati. Nessuna nuova intent.
  return { kind: 'already_paid' }
}

/** Un addebito riuscito rende l'ordine pagato anche se l'intent e' canceled. */
function chargeSucceeded(intent: StripePaymentIntent): boolean {
  if (intent.paid === true) return true
  const charge = intent.latest_charge
  return typeof charge === 'object' && charge !== null && charge.status === 'succeeded'
}

/** Il client reale, costruito solo quando serve (nessuna chiave richiesta all'import). */
export function realStripeIntentDeps(): StripeIntentDeps {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    httpClient: Stripe.createFetchHttpClient(),
    // Un retry interno dell'SDK nasconderebbe il timeout ambiguo al chiamante:
    // la rotta deve ricevere l'errore e lasciare che sia la richiesta
    // successiva, con la stessa chiave, a ritrovare la PaymentIntent.
    maxNetworkRetries: 0,
    // Nessun id di telemetria persistito su disco: il client non deve
    // scrivere fuori dalla richiesta per una chiamata di pagamento.
    telemetry: false,
  })
  return { paymentIntents: stripe.paymentIntents }
}
