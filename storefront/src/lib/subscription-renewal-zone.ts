// storefront/src/lib/subscription-renewal-zone.ts
//
// Un rinnovo si PREZZA da `record.zone` (la zona registrata nel CMS, cioe' il
// contratto) ma si SPEDISCE a `invoice.customer_shipping`. Se qualcuno cambia
// l'indirizzo di un abbonato a mano — supporto o dashboard Stripe — le due cose
// divergono: il cliente continua a pagare la tariffa della zona vecchia a ogni
// ciclo, la perdita si ricrea ogni mese e nessuno la vede.
//
// Qui non si corregge niente. Cambiare la zona da soli vuol dire cambiare il
// prezzo a un cliente senza il suo consenso: e' una decisione commerciale, non un
// effetto collaterale di un webhook. Si misura la divergenza e si produce il
// segnale; il rinnovo gia' pagato continua a funzionare.
//
// Attenzione alle due "zone", che non sono lo stesso insieme: la zona della
// SCALA dei prezzi (`Zone` in `subscription-plans.ts`) e' un prodotto e comprende
// CH/NO/IS/LI; la zona di SPEDIZIONE (`getShippingZone`) e' il confine doganale e
// mette quei paesi in `EXTRA_EU`. Confrontare la seconda con la prima e' proprio
// il punto: un rinnovo verso la Svizzera addebita 14,99 contro un costo sdoganato
// stimato di 41-44, e finora nessuno lo vedeva.
//
// Modulo puro di proposito: nessuna rete, nessun SDK Stripe, nessun accesso al
// CMS. La consegna del segnale sta in `subscription-renewal-zone-alert.ts`, cosi'
// questa logica si prova senza stub e senza credenziali.

import { getShippingZone, type ShippingZone } from './shipping'
import { getBenefitForCycle, type PlanKey, type Zone } from './subscription-plans'

/** Dove arriva davvero il pacco. `unknown` = paese assente, NON "extra-UE". */
export type DestinationZone = ShippingZone | 'unknown'

export type RenewalZoneAlertReason =
  /** La destinazione e' in un'altra zona della scala: caso normale da segnalare. */
  | 'zone_changed'
  /** La fattura non dice dove si spedisce: non e' una prova di nessuna zona. */
  | 'destination_unknown'
  /** Destinazione fuori dalle zone dell'abbonamento: la scala non ha una tariffa da confrontare. */
  | 'destination_outside_subscription_zones'
  /** Il documento CMS non ha una zona della scala: il prezzo di partenza non e' verificabile. */
  | 'registered_zone_invalid'

export interface RenewalZoneCost {
  registeredShipping: number
  destinationShipping: number
  registeredTotal: number
  destinationTotal: number
  /** destinationShipping - registeredShipping. Positivo = si incassa MENO del dovuto. */
  shippingDelta: number
  /** destinationTotal - registeredTotal, stesso segno. */
  totalDelta: number
}

export interface RenewalZoneMismatch {
  subscriptionId: string
  plan: PlanKey
  cycle: number
  registeredZone: string
  destinationZone: DestinationZone
  destinationCountry: string | null
  reason: RenewalZoneAlertReason
  /**
   * null quando il confronto non e' calcolabile: la destinazione non ha una
   * tariffa nella scala dell'abbonamento, oppure manca il paese. Non si stima e
   * non si inventa un delta.
   */
  cost: RenewalZoneCost | null
}

/** Il segnale che finisce nel log strutturato e nell'alert. Senza dati personali. */
export interface RenewalZoneAlertPayload {
  event: 'subscription_renewal_zone_mismatch'
  subscriptionId: string
  plan: PlanKey
  cycle: number
  registeredZone: string
  destinationZone: DestinationZone
  destinationCountry: string | null
  reason: RenewalZoneAlertReason
  registeredShipping: number | null
  destinationShipping: number | null
  shippingDelta: number | null
  totalDelta: number | null
}

export function normalizeDestinationCountry(value: unknown): string | null {
  const country = String(value ?? '').trim().toUpperCase()
  return country === '' ? null : country
}

/**
 * Zona della destinazione della fattura. Un paese assente resta `unknown`: non
 * si ricade sulla zona registrata, perche' quella e' proprio l'ipotesi da
 * verificare, e non si ricade nemmeno su `EXTRA_EU` (che sarebbe una conclusione
 * su un dato che non c'e').
 */
export function resolveDestinationZone(value: unknown): DestinationZone {
  const country = normalizeDestinationCountry(value)
  if (!country) return 'unknown'
  return getShippingZone(country)
}

function isSubscriptionZone(value: unknown): value is Zone {
  return value === 'IT' || value === 'EU'
}

/** Arrotonda al centesimo, cosi' i delta non portano il rumore del floating point. */
function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

function costFor(plan: PlanKey, cycle: number, registeredZone: Zone, destinationZone: Zone): RenewalZoneCost {
  const registered = getBenefitForCycle(plan, registeredZone, cycle)
  const destination = getBenefitForCycle(plan, destinationZone, cycle)
  return {
    registeredShipping: registered.shippingPrice,
    destinationShipping: destination.shippingPrice,
    registeredTotal: registered.total,
    destinationTotal: destination.total,
    shippingDelta: roundMoney(destination.shippingPrice - registered.shippingPrice),
    totalDelta: roundMoney(destination.total - registered.total),
  }
}

/**
 * Confronta la zona registrata con quella della destinazione della fattura.
 *
 * Ritorna `null` quando le due coincidono: nessun segnale, nessun rumore. In
 * ogni altro caso ritorna la divergenza — anche quando il delta non e'
 * calcolabile, perche' "non lo so" e' una cosa da dire, non da tacere.
 */
export function detectRenewalZoneMismatch(params: {
  subscriptionId: string
  plan: PlanKey
  cycle: number
  registeredZone: unknown
  destinationCountry: unknown
}): RenewalZoneMismatch | null {
  const { subscriptionId, plan, cycle } = params
  const registeredZone = String(params.registeredZone ?? '').trim().toUpperCase()
  const destinationCountry = normalizeDestinationCountry(params.destinationCountry)
  const destinationZone = resolveDestinationZone(params.destinationCountry)

  const base = { subscriptionId, plan, cycle, registeredZone, destinationZone, destinationCountry }

  if (!isSubscriptionZone(registeredZone)) {
    return { ...base, reason: 'registered_zone_invalid', cost: null }
  }
  if (destinationZone === 'unknown') {
    return { ...base, reason: 'destination_unknown', cost: null }
  }
  if (destinationZone === 'EXTRA_EU') {
    return { ...base, reason: 'destination_outside_subscription_zones', cost: null }
  }
  if (destinationZone === registeredZone) return null

  return {
    ...base,
    reason: 'zone_changed',
    cost: costFor(plan, cycle, registeredZone, destinationZone),
  }
}

export function buildRenewalZoneAlertPayload(mismatch: RenewalZoneMismatch): RenewalZoneAlertPayload {
  return {
    event: 'subscription_renewal_zone_mismatch',
    subscriptionId: mismatch.subscriptionId,
    plan: mismatch.plan,
    cycle: mismatch.cycle,
    registeredZone: mismatch.registeredZone,
    destinationZone: mismatch.destinationZone,
    destinationCountry: mismatch.destinationCountry,
    reason: mismatch.reason,
    registeredShipping: mismatch.cost?.registeredShipping ?? null,
    destinationShipping: mismatch.cost?.destinationShipping ?? null,
    shippingDelta: mismatch.cost?.shippingDelta ?? null,
    totalDelta: mismatch.cost?.totalDelta ?? null,
  }
}
