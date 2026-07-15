// storefront/src/lib/stripe-subscription-schedule.ts
import Stripe from 'stripe'
import { SUBSCRIPTION_LADDER, PLAN_NAMES, type PlanKey, type Zone } from './subscription-plans'

const PRODUCT_METADATA_KEY = 'foolishSubscriptionPlanKey'

/**
 * Le Subscription Schedule di Stripe richiedono un Product ID reale per ogni
 * price_data (a differenza delle Checkout Session, che accettano product_data
 * inline). Cerchiamo il prodotto per metadata e lo creiamo solo se non esiste,
 * così restano sempre e solo 2 Product Stripe totali (uno per piano — la zona
 * incide solo sul prezzo, non sul prodotto), senza alcuno step manuale.
 */
async function getOrCreatePlanProduct(stripe: Stripe, plan: PlanKey): Promise<string> {
  const search = await stripe.products.search({
    query: `metadata['${PRODUCT_METADATA_KEY}']:'${plan}'`,
  })
  if (search.data[0]) return search.data[0].id

  const created = await stripe.products.create({
    name: PLAN_NAMES[plan],
    metadata: { [PRODUCT_METADATA_KEY]: plan },
  })
  return created.id
}

export async function buildSchedulePhases(
  stripe: Stripe,
  plan: PlanKey,
  zone: Zone,
): Promise<Stripe.SubscriptionScheduleCreateParams.Phase[]> {
  const productId = await getOrCreatePlanProduct(stripe, plan)
  const config = SUBSCRIPTION_LADDER[plan][zone]
  return config.phases.map((phase) => ({
    duration: { interval: 'month', interval_count: phase.iterations },
    items: [
      {
        price_data: {
          currency: 'eur',
          product: productId,
          recurring: { interval: 'month' },
          unit_amount: Math.round((phase.productPrice + phase.shippingPrice) * 100),
        },
        quantity: 1,
      },
    ],
  }))
}

/**
 * Converte la Subscription appena creata da Checkout in uno Subscription Schedule
 * a 3 fasi. La prima fase deve riusare lo start_date che Stripe assegna
 * automaticamente alla fase corrente (già in corso di fatturazione) — non può
 * essere una nostra scelta arbitraria, altrimenti Stripe rifiuta l'update.
 */
export async function attachScheduleToSubscription(
  stripe: Stripe,
  subscriptionId: string,
  plan: PlanKey,
  zone: Zone,
): Promise<Stripe.SubscriptionSchedule> {
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscriptionId })
  const builtPhases = await buildSchedulePhases(stripe, plan, zone)
  const currentPhaseStart = schedule.phases[0].start_date

  return stripe.subscriptionSchedules.update(schedule.id, {
    end_behavior: 'release',
    phases: [
      { ...builtPhases[0], start_date: currentPhaseStart },
      builtPhases[1],
      builtPhases[2],
    ],
  })
}
