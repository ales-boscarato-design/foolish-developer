// storefront/src/lib/subscription-plans.ts
import { EU_CUSTOMS_UNION } from './shipping'

export type PlanKey = 'tattoo' | 'pmu'
export type Zone = 'IT' | 'EU'

export interface PlanPhase {
  /** Numero di rinnovi in cui questa fase è attiva (l'ultima fase resta attiva indefinitamente dopo l'ultima iterazione). */
  iterations: number
  productPrice: number
  shippingPrice: number
  /** Se questo ciclo include il foglio/viso omaggio in fulfillment (non incide sul prezzo Stripe). */
  giftItem: boolean
}

export interface PlanConfig {
  giftLabel: string
  phases: [PlanPhase, PlanPhase, PlanPhase]
}

export const SUBSCRIPTION_LADDER: Record<PlanKey, Record<Zone, PlanConfig>> = {
  tattoo: {
    IT: {
      giftLabel: 'Foglio omaggio',
      phases: [
        { iterations: 1, productPrice: 45, shippingPrice: 7.65, giftItem: false },
        { iterations: 4, productPrice: 45, shippingPrice: 0, giftItem: false },
        { iterations: 1, productPrice: 40.5, shippingPrice: 0, giftItem: false },
      ],
    },
    EU: {
      giftLabel: 'Foglio omaggio',
      phases: [
        { iterations: 1, productPrice: 45, shippingPrice: 14.99, giftItem: false },
        { iterations: 4, productPrice: 45, shippingPrice: 14.99, giftItem: true },
        { iterations: 1, productPrice: 40.5, shippingPrice: 14.99, giftItem: true },
      ],
    },
  },
  pmu: {
    IT: {
      giftLabel: '4° viso omaggio',
      phases: [
        { iterations: 1, productPrice: 67.5, shippingPrice: 0, giftItem: false },
        { iterations: 4, productPrice: 60.75, shippingPrice: 0, giftItem: false },
        { iterations: 1, productPrice: 60.75, shippingPrice: 0, giftItem: true },
      ],
    },
    EU: {
      giftLabel: '4° viso omaggio',
      phases: [
        { iterations: 1, productPrice: 67.5, shippingPrice: 14.99, giftItem: false },
        { iterations: 4, productPrice: 67.5, shippingPrice: 14.99, giftItem: true },
        { iterations: 1, productPrice: 60.75, shippingPrice: 14.99, giftItem: true },
      ],
    },
  },
}

/** Ciclo 1 → fase 0. Cicli 2-5 → fase 1. Ciclo 6+ → fase 2. */
export function getPhaseIndexForCycle(cycle: number): 0 | 1 | 2 {
  if (cycle <= 1) return 0
  if (cycle <= 5) return 1
  return 2
}

export function getBenefitForCycle(plan: PlanKey, zone: Zone, cycle: number) {
  const config = SUBSCRIPTION_LADDER[plan][zone]
  const phase = config.phases[getPhaseIndexForCycle(cycle)]
  return {
    productPrice: phase.productPrice,
    shippingPrice: phase.shippingPrice,
    giftItem: phase.giftItem,
    total: Math.round((phase.productPrice + phase.shippingPrice) * 100) / 100,
  }
}

/** Cicli mancanti al raggiungimento del ciclo 6 (tier finale). 0 se già raggiunto. */
export function getNextTierCyclesRemaining(cyclesCompleted: number): number {
  return Math.max(0, 6 - cyclesCompleted)
}

/**
 * Destinazioni ammesse su una NUOVA attivazione, per zona.
 *
 * Solo territorio doganale UE, perche' un abbonamento verso una destinazione
 * extra-UE addebita 14,99 EUR di spedizione a ogni ciclo (la scala
 * dell'abbonamento e' un prodotto, non un confine doganale) contro un costo
 * sdoganato stimato di 41,17 (tattoo) / 43,90 (pmu): e' una spedizione sotto
 * costo che si ripete ogni mese.
 *
 * Decisione di Alessandro (21/09/2026): le NUOVE attivazioni verso destinazioni
 * extra-UE restano chiuse; i rinnovi gia' attivi non cambiano. `SUBSCRIPTION_LADDER`
 * resta percio' intatto (CH/NO/IS/LI comprese in `EU_COUNTRIES`): e' la storia
 * dei contratti in corso, che si tocca caso per caso, non una lista di
 * destinazioni vendibili.
 *
 * La destinazione la decide il server: questa lista finisce in
 * `shipping_address_collection.allowed_countries` di Stripe, quindi un
 * indirizzo extra-UE non e' accettato al checkout dell'abbonamento anche se il
 * client chiede la zona "EU" nel body.
 */
export const ZONE_COUNTRIES: Record<Zone, string[]> = {
  IT: ['IT'],
  EU: [...EU_CUSTOMS_UNION],
}

/** true se la destinazione puo' aprire una nuova attivazione per quella zona. */
export function isActivatableDestination(zone: Zone, countryCode: string): boolean {
  const c = String(countryCode ?? '').toUpperCase()
  return ZONE_COUNTRIES[zone].includes(c)
}

/**
 * Un cambio di zona richiesto dal cliente cambia la tariffa che paga a ogni
 * ciclo: la destinazione REALE dell'abbonamento deve poter stare nella zona di
 * arrivo, esattamente come per una nuova attivazione. Per questo la regola non
 * ha una lista propria e passa da `isActivatableDestination` — l'unica fonte
 * delle destinazioni ammesse resta `ZONE_COUNTRIES`.
 *
 * Decisione di Alessandro (21/09/2026, chiudendo la falla del cambio zona): se
 * la destinazione e' extra-UE il cambio non e' piu' possibile — la tariffa
 * segue il destino. Un abbonato con indirizzo svizzero che passasse alla scala
 * `EU` pagherebbe 14,99 EUR di spedizione a ciclo contro un costo sdoganato
 * stimato di 48,00 su un carrello da 45,00 e 52,49 su uno da 99,00 (`shipping.ts`,
 * misurato il 21/09/2026): la stessa perdita che la chiusura delle nuove
 * attivazioni extra-UE esiste per evitare, per una via diversa.
 *
 * Destinazione ignota -> false (fail-closed): un cambio di tariffa non si
 * autorizza su un indirizzo che non si sa dove sia. I rinnovi in corso non
 * passano di qui e restano al prezzo contrattato.
 */
export function isZoneChangeAllowed(newZone: Zone, destinationCountry: string | null | undefined): boolean {
  const country = String(destinationCountry ?? '').trim()
  if (!country) return false
  return isActivatableDestination(newZone, country)
}

export const PLAN_NAMES: Record<PlanKey, string> = {
  tattoo: 'Abbonamento Tattoo XXL',
  pmu: 'Abbonamento PMU 3 Visi',
}
