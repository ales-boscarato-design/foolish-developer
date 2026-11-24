import type Stripe from 'stripe'

/**
 * Fotografia cumulativa dei rimborsi di un charge, letta da Stripe in SOLA LETTURA.
 *
 * PERCHE' ESISTE (card t_6f9c968d). `charge.amount_refunded` da' l'importo
 * cumulativo ma **scende** quando Stripe passa un rimborso a `failed`/`canceled`:
 * un ordinamento basato solo sull'importo non distingue un rimborso annullato
 * (calo legittimo da applicare) da uno snapshot consegnato fuori ordine (calo da
 * rifiutare). La sorgente di ordinamento e' quindi il **numero di rimborsi**
 * presenti sul charge (`refundCount`): Stripe non cancella i rimborsi, il
 * conteggio cresce quando ne nasce uno e non torna mai indietro.
 *
 * Il conteggio deve essere COMPLETO: `charge.refunds` porta al massimo dieci
 * rimborsi, quindi si pagina `stripe.refunds.list`. Se l'elenco resta incompleto
 * la funzione lancia: meglio un retry di Stripe che un conteggio inventato.
 */

export const MAX_REFUND_AMOUNT_CENTS = 100_000_000_000
const MAX_REFUND_OBJECTS = 10_000
const REFUND_PAGE_SIZE = 100

const CHARGE_ID_RE = /^ch_[A-Za-z0-9_]+$/
const PAYMENT_INTENT_RE = /^pi_[A-Za-z0-9_]{1,127}$/

export interface ChargeRefundSnapshot {
  charge: Stripe.Charge
  chargeId: string
  paymentIntentId: string
  chargeAmountCents: number
  amountRefundedCents: number
  /** Numero di rimborsi presenti sul charge: chiave di ordinamento, non importo. */
  refundCount: number
  /** `created` del rimborso piu' recente, in ISO. `null` se il charge non ne ha. */
  lastRefundedAt: string | null
}

export function validChargeId(value: unknown): value is string {
  return typeof value === 'string' && CHARGE_ID_RE.test(value)
}

function validCreated(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function validCents(value: unknown, min: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= MAX_REFUND_AMOUNT_CENTS
}

export function paymentIntentIdOf(charge: Pick<Stripe.Charge, 'payment_intent'>): string | null {
  const value = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id
  return typeof value === 'string' && PAYMENT_INTENT_RE.test(value) ? value : null
}

/**
 * Elenco completo dei rimborsi del charge. Usa quello gia' allegato al charge
 * quando e' completo, altrimenti pagina `stripe.refunds.list` (sola lettura).
 */
export async function readChargeRefunds(stripe: Stripe, charge: Stripe.Charge): Promise<Stripe.Refund[]> {
  if (!validChargeId(charge.id)) throw new Error('Invalid charge identity')
  const inline = charge.refunds
  if (inline && inline.has_more === false && Array.isArray(inline.data)) {
    if (inline.data.length > MAX_REFUND_OBJECTS) throw new Error('Stripe refund list too large')
    return inline.data
  }

  const refunds: Stripe.Refund[] = []
  let startingAfter: string | undefined
  for (;;) {
    const page = await stripe.refunds.list({
      charge: charge.id,
      limit: REFUND_PAGE_SIZE,
      ...(startingAfter === undefined ? {} : { starting_after: startingAfter }),
    })
    refunds.push(...page.data)
    if (refunds.length > MAX_REFUND_OBJECTS) throw new Error('Stripe refund list too large')
    if (page.has_more !== true) return refunds
    const last = page.data[page.data.length - 1]
    if (!last || typeof last.id !== 'string' || last.id.length === 0) {
      throw new Error('Incomplete Stripe refund list')
    }
    startingAfter = last.id
  }
}

/** Validazione pura della fotografia: fail-closed su ogni valore non affidabile. */
export function buildChargeRefundSnapshot(charge: Stripe.Charge, refunds: Stripe.Refund[]): ChargeRefundSnapshot {
  if (!validChargeId(charge.id)) throw new Error('Invalid charge identity')
  const paymentIntentId = paymentIntentIdOf(charge)
  if (paymentIntentId === null) throw new Error('Invalid cumulative Stripe refund')
  if (!validCents(charge.amount, 1)) throw new Error('Invalid cumulative Stripe refund')
  if (!validCents(charge.amount_refunded, 0) || charge.amount_refunded > charge.amount) {
    throw new Error('Invalid cumulative Stripe refund')
  }
  if (typeof charge.currency !== 'string' || charge.currency.toLowerCase() !== 'eur') {
    throw new Error('Invalid cumulative Stripe refund')
  }
  if (refunds.length > MAX_REFUND_OBJECTS) throw new Error('Stripe refund list too large')
  if (!refunds.every((refund) => validCreated(refund.created))) {
    throw new Error('Invalid Stripe refund entry')
  }
  // Un cumulativo positivo senza nessun rimborso elencato significa che l'elenco
  // letto non e' completo: il conteggio non sarebbe una chiave affidabile.
  if (refunds.length === 0 && charge.amount_refunded > 0) throw new Error('Incomplete Stripe refund list')

  const latest = refunds.reduce<number | null>(
    (max, refund) => (max === null || refund.created > max ? refund.created : max),
    null,
  )

  return {
    charge,
    chargeId: charge.id,
    paymentIntentId,
    chargeAmountCents: charge.amount,
    amountRefundedCents: charge.amount_refunded,
    refundCount: refunds.length,
    lastRefundedAt: latest === null ? null : new Date(latest * 1000).toISOString(),
  }
}

/** Rilegge il charge da Stripe (sola lettura) e ne restituisce la fotografia affidabile. */
export async function readChargeRefundSnapshot(stripe: Stripe, chargeId: string): Promise<ChargeRefundSnapshot> {
  if (!validChargeId(chargeId)) throw new Error('Invalid charge identity')
  const charge = await stripe.charges.retrieve(chargeId)
  const refunds = await readChargeRefunds(stripe, charge)
  return buildChargeRefundSnapshot(charge, refunds)
}
