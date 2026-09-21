// storefront/src/lib/subscription-zone-change.ts
//
// Nucleo del cambio di zona di un abbonamento. Vive fuori dalla route perche' la
// destinazione reale dell'abbonamento non e' nel CMS: va letta da Stripe, e senza
// questa lettura il cambio di zona diventa una scorciatoia per pagare 14,99 EUR di
// spedizione su una destinazione extra-UE (costo sdoganato stimato 40,99/43,79).
//
// Il cambio di zona e' un cambio di TARIFFA: passa dalla stessa policy delle nuove
// attivazioni (`isZoneChangeAllowed`), e quando la destinazione non e' chiara non
// si autorizza nulla (fail-closed). I rinnovi in corso non passano di qui.

import type Stripe from 'stripe'
import { isZoneChangeAllowed, type PlanKey, type Zone } from './subscription-plans'
import { rebuildRemainingPhases } from './stripe-subscription-schedule'

export interface SubscriptionDoc {
  id: string
  customerEmail?: string
  plan: PlanKey
  zone: Zone
  stripeSubscriptionId?: string
  stripeScheduleId?: string
  cyclesCompleted: number
}

export interface ZoneChangeDeps {
  stripe: Stripe
  cmsUrl: string
  cmsSecret: string
  fetchImpl?: typeof fetch
}

export interface ZoneChangeRequest {
  subscriptionDocId: unknown
  newZone: unknown
  sessionEmail: string
}

export interface ZoneChangeResponse {
  status: number
  body: { ok?: true; error?: string }
}

export interface SubscriptionDestination {
  country: string | null
  source: 'invoice' | 'customer' | null
  /** true se almeno una delle due letture e' fallita: senza paese non si distingue "non esiste" da "non ho potuto chiedere". */
  lookupFailed: boolean
}

function normalizeCountry(value: unknown): string | null {
  const country = String(value ?? '').trim().toUpperCase()
  return country === '' ? null : country
}

/**
 * Destinazione reale dell'abbonamento, dalla prima fonte che risponde:
 *
 *  1. l'ultima fattura della subscription (`invoice.customer_shipping`): e' la
 *     stessa fonte con cui il webhook spedisce i rinnovi — se le due divergono,
 *     il prezzo e il pacco viaggerebbero in due posti diversi;
 *  2. l'indirizzo di spedizione del cliente (`customer.shipping`), dove Stripe
 *     Checkout lo salva al momento dell'attivazione.
 *
 * Solo l'ULTIMA fattura conta, e l'ordine della lista non si assume (si
 * confronta `created`): un paese trovato su una fattura vecchia non e' una
 * prova di dove si spedisce adesso, e un cambio di tariffa non si autorizza su
 * un indizio. Un errore di Stripe non viene interpretato: si annota
 * `lookupFailed` e il chiamante decide (senza paese non si autorizza il cambio).
 */
export async function resolveSubscriptionDestination(
  stripe: Stripe,
  subscriptionId: string,
): Promise<SubscriptionDestination> {
  let lookupFailed = false

  try {
    const invoices = await stripe.invoices.list({ subscription: subscriptionId, limit: 3 })
    const latest = (invoices.data ?? []).reduce<Stripe.Invoice | null>(
      (newest, invoice) => (newest && newest.created >= invoice.created ? newest : invoice),
      null,
    )
    const country = normalizeCountry(latest?.customer_shipping?.address?.country)
    if (country) return { country, source: 'invoice', lookupFailed }
  } catch {
    lookupFailed = true
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId)
    const customer = subscription.customer
    const customerId = typeof customer === 'string' ? customer : customer?.id
    if (!customerId) {
      lookupFailed = true
    } else {
      const retrieved = await stripe.customers.retrieve(customerId)
      const deleted = 'deleted' in retrieved && retrieved.deleted === true
      const country = deleted ? null : normalizeCountry(retrieved.shipping?.address?.country)
      if (country) return { country, source: 'customer', lookupFailed }
    }
  } catch {
    lookupFailed = true
  }

  return { country: null, source: null, lookupFailed }
}

export async function changeSubscriptionZone(
  deps: ZoneChangeDeps,
  request: ZoneChangeRequest,
): Promise<ZoneChangeResponse> {
  const fetchImpl = deps.fetchImpl ?? fetch

  const subscriptionDocId = typeof request.subscriptionDocId === 'string' ? request.subscriptionDocId.trim() : ''
  const newZone = request.newZone
  if (!subscriptionDocId || (newZone !== 'IT' && newZone !== 'EU')) {
    return { status: 400, body: { error: 'Parametri non validi' } }
  }

  const docRes = await fetchImpl(`${deps.cmsUrl}/api/subscriptions/${encodeURIComponent(subscriptionDocId)}`, {
    headers: { 'x-storefront-secret': deps.cmsSecret },
  })
  if (!docRes.ok) return { status: 404, body: { error: 'Abbonamento non trovato' } }
  const doc = (await docRes.json()) as SubscriptionDoc

  if (String(doc.customerEmail ?? '').toLowerCase() !== String(request.sessionEmail ?? '').toLowerCase()) {
    return { status: 403, body: { error: 'Non autorizzato' } }
  }
  if (doc.zone === newZone) {
    return { status: 200, body: { ok: true } } // nessun cambiamento
  }
  if (!doc.stripeScheduleId) {
    return { status: 400, body: { error: 'Abbonamento senza schedule Stripe' } }
  }
  if (!doc.stripeSubscriptionId) {
    return { status: 409, body: { error: "Destinazione dell'abbonamento non verificabile" } }
  }

  // Il confine: il cambio di zona e' un cambio di tariffa, quindi la destinazione
  // reale dell'abbonamento deve poter stare nella zona di arrivo (stessa policy
  // delle nuove attivazioni). Finche' non e' ammesso non si scrive nulla: ne' le
  // fasi Stripe, ne' il documento CMS.
  const destination = await resolveSubscriptionDestination(deps.stripe, doc.stripeSubscriptionId)
  if (!isZoneChangeAllowed(newZone, destination.country)) {
    if (!destination.country && destination.lookupFailed) {
      return { status: 503, body: { error: "Destinazione dell'abbonamento non verificabile, riprova" } }
    }
    return { status: 409, body: { error: "Cambio zona non disponibile per la destinazione dell'abbonamento" } }
  }

  try {
    await rebuildRemainingPhases(deps.stripe, doc.stripeScheduleId, doc.plan, newZone, doc.cyclesCompleted)
  } catch {
    return { status: 502, body: { error: 'Errore aggiornamento piano Stripe' } }
  }

  const patchRes = await fetchImpl(`${deps.cmsUrl}/api/subscriptions/${encodeURIComponent(subscriptionDocId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-storefront-secret': deps.cmsSecret },
    body: JSON.stringify({ zone: newZone }),
  })
  if (!patchRes.ok) return { status: 500, body: { error: 'Errore aggiornamento abbonamento' } }

  return { status: 200, body: { ok: true } }
}
