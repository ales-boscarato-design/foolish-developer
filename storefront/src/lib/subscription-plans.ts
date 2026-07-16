// storefront/src/lib/subscription-plans.ts
import { EU_COUNTRIES } from './shipping'

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

export const ZONE_COUNTRIES: Record<Zone, string[]> = {
  IT: ['IT'],
  EU: [...EU_COUNTRIES],
}

export const PLAN_NAMES: Record<PlanKey, string> = {
  tattoo: 'Abbonamento Tattoo XXL',
  pmu: 'Abbonamento PMU 3 Visi',
}
