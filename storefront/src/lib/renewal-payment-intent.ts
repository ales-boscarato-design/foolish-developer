/**
 * Risoluzione del PaymentIntent di un rinnovo abbonamento, da `invoice.paid`.
 *
 * PERCHE' ESISTE. L'ordine di rinnovo porta `stripePaymentIntentId` solo quando
 * `invoice.payments` contiene esattamente un pagamento pagato di tipo
 * `payment_intent`. Con la lista assente, paginata o con piu' pagamenti il
 * campo resta vuoto, e da quel momento il rinnovo non e' piu' raggiungibile da
 * un rimborso (`/api/orders/apply-refund-transition` risponde `missing` → 503 a
 * ogni consegna dell'evento). Il caso non era ne' coperto ne' contabile: senza
 * un segnale l'ordine sembrava normale.
 *
 * MISURATO IL 20/11/2026 (sola lettura, API `2026-04-22.dahlia`): su
 * un'invoice di subscription pagata, `invoice.payments` NON compare ne'
 * nell'oggetto dell'evento ne' in `invoices.retrieve` senza `expand`; compare
 * solo con `expand[]=payments`, dove porta un solo pagamento `paid` di tipo
 * `payment_intent`. Cioe' il caso «assente» non e' un residuo teorico: e' la
 * forma normale di ogni rinnovo, e per questo il segnale e' indispensabile.
 *
 * Il modulo e' puro (nessuna chiamata di rete) e si legge per casi: la rotta
 * emette una riga JSON solo quando `status === 'missing'`.
 */

/** Motivi per cui un rinnovo resta senza PaymentIntent. */
export type RenewalPaymentIntentGap =
  /** `invoice.payments` non c'e' (forma normale degli eventi `invoice.paid`). */
  | 'payments_absent'
  /** `has_more !== false`: la lista e' troncata, il pagamento puo' essere oltre. */
  | 'payments_paginated'
  /** Lista completa ma senza esattamente un pagamento pagato valido. */
  | 'payments_ambiguous'

export type RenewalPaymentIntent =
  | { status: 'resolved'; paymentIntentId: string }
  | { status: 'missing'; reason: RenewalPaymentIntentGap }

/** Forma strutturale minima di `invoice.payments` (evita un cast nell'handler). */
export interface InvoicePaymentsLike {
  has_more?: boolean | null
  data?: Array<{
    status?: string | null
    payment?: {
      type?: string | null
      payment_intent?: string | { id?: string | null } | null
    } | null
  }> | null
}

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]{1,127}$/

/**
 * Classifica la lista pagamenti dell'invoice. Il primo criterio e' la forma
 * della lista (assente / troncata / completa), il secondo il contenuto:
 * una lista completa con zero o con due pagamenti pagati non permette di
 * scegliere, quindi e' `payments_ambiguous` — mai un id indovinato.
 */
export function resolveRenewalPaymentIntent(payments: InvoicePaymentsLike | null | undefined): RenewalPaymentIntent {
  if (!payments) return { status: 'missing', reason: 'payments_absent' }
  if (payments.has_more !== false) return { status: 'missing', reason: 'payments_paginated' }

  const paidPaymentIntents = (payments.data ?? []).filter(
    (entry) => entry?.status === 'paid' && entry?.payment?.type === 'payment_intent',
  )
  if (paidPaymentIntents.length !== 1) return { status: 'missing', reason: 'payments_ambiguous' }

  const target = paidPaymentIntents[0]?.payment?.payment_intent
  const paymentIntentId = typeof target === 'string' ? target : target?.id
  if (typeof paymentIntentId !== 'string' || !PAYMENT_INTENT_ID.test(paymentIntentId)) {
    return { status: 'missing', reason: 'payments_ambiguous' }
  }
  return { status: 'resolved', paymentIntentId }
}

/**
 * Riga JSON del segnale, senza dati cliente: `orderRef` e motivo bastano a
 * ritrovare l'ordine e a contarlo. Il numero d'ordine di rinnovo
 * (`FOOLISH-SUB-<subscription>-<invoice>`) non contiene dati personali.
 */
export function renewalPaymentIntentSignal(orderRef: string, reason: RenewalPaymentIntentGap): string {
  return JSON.stringify({
    event: 'renewal_order_without_payment_intent',
    orderRef,
    reason,
  })
}
