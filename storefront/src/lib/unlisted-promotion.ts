type SubscriptionCard = { plan: 'tattoo' | 'pmu' }
type SubscriptionConfig = { product: object } | null | undefined

// `unlisted` e' un ritiro SOLO retail: l'hub abbonamenti dipende dal piano attivo
// che referenzia il prodotto, non dallo stato di vetrina del prodotto stesso.
export function availableSubscriptionCards<T extends SubscriptionCard>(
  cards: readonly T[],
  configs: Partial<Record<'tattoo' | 'pmu', SubscriptionConfig>>,
): T[] {
  return cards.filter((card) => {
    const config = configs[card.plan]
    return config != null && config.product != null
  })
}
