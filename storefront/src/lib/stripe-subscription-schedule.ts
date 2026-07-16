// storefront/src/lib/stripe-subscription-schedule.ts
import Stripe from 'stripe'
import { SUBSCRIPTION_LADDER, PLAN_NAMES, getPhaseIndexForCycle, type PlanKey, type Zone } from './subscription-plans'

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

  // Idempotency key prevents duplicate products if concurrent requests both miss
  // the search (Stripe Search API eventual consistency) and both attempt create().
  // With the same key, Stripe dedupes within the idempotency window.
  const created = await stripe.products.create(
    {
      name: PLAN_NAMES[plan],
      metadata: { [PRODUCT_METADATA_KEY]: plan },
    },
    { idempotencyKey: `subscription-plan-product-${plan}` }
  )
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

/**
 * Ricostruisce le fasi Stripe da adesso in poi per riflettere la nuova zona,
 * preservando cyclesCompleted (nessun reset). La fase in corso di fatturazione
 * (quella che contiene "adesso") deve avere lo stesso start_date già assegnato
 * da Stripe — non possiamo riscrivere il passato di uno schedule esistente.
 *
 * Nota: usiamo `schedule.current_phase.start_date` (non `schedule.phases[...]`
 * per posizione) perché è il campo che Stripe espone esplicitamente per questo
 * scopo — vedi `SubscriptionSchedule.CurrentPhase` in
 * node_modules/stripe/cjs/resources/SubscriptionSchedules.d.ts ("Object
 * representing the start and end dates for the current phase of the
 * subscription schedule, if it is `active`"). Assumere che la fase corrente
 * sia sempre l'ultimo elemento di `schedule.phases` sarebbe fragile (e falso
 * dopo un secondo cambio zona, quando l'array può contenere fasi passate).
 */
export async function rebuildRemainingPhases(
  stripe: Stripe,
  scheduleId: string,
  plan: PlanKey,
  newZone: Zone,
  cyclesCompleted: number,
): Promise<Stripe.SubscriptionSchedule> {
  const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
  if (!schedule.current_phase) {
    throw new Error(`Subscription schedule ${scheduleId} non ha una fase attiva (status: ${schedule.status})`)
  }
  const currentPhaseStart = schedule.current_phase.start_date

  const nextCycle = cyclesCompleted + 1
  const currentPhaseIndex = getPhaseIndexForCycle(nextCycle)
  const allPhases = await buildSchedulePhases(stripe, plan, newZone)
  const newPhases = allPhases.slice(currentPhaseIndex)

  return stripe.subscriptionSchedules.update(scheduleId, {
    end_behavior: 'release',
    phases: [
      { ...newPhases[0], start_date: currentPhaseStart },
      ...newPhases.slice(1),
    ],
  })
}
