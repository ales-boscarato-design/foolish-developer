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

export interface StripeIntentDeps {
  paymentIntents: {
    create(
      params: StripeIntentParams,
      opts: { idempotencyKey: string },
    ): Promise<{ client_secret: string | null }>
  }
}

export interface OrderPaymentIntentArgs {
  amountCents: number
  orderId: string | number
  orderNumber: string
  resellerEmail: string
}

/**
 * `orderNumber` e' la chiave di idempotenza: un doppio click sul pagamento
 * non deve addebitare due volte lo stesso ordine.
 */
export function createOrderPaymentIntent(
  args: OrderPaymentIntentArgs,
  deps: StripeIntentDeps,
): Promise<{ client_secret: string | null }> {
  return deps.paymentIntents.create({
    amount: args.amountCents,
    currency: 'eur',
    metadata: {
      orderId: String(args.orderId),
      orderNumber: args.orderNumber,
      resellerEmail: args.resellerEmail,
    },
    automatic_payment_methods: { enabled: true },
  }, {
    idempotencyKey: args.orderNumber,
  })
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
