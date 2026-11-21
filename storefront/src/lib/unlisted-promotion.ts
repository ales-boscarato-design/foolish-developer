type SubscriptionCard = { plan: 'tattoo' | 'pmu' }
type SubscriptionConfig = { product: { unlisted?: boolean } } | null | undefined

export function listedSubscriptionCards<T extends SubscriptionCard>(
  cards: readonly T[],
  configs: Partial<Record<'tattoo' | 'pmu', SubscriptionConfig>>,
): T[] {
  return cards.filter((card) => {
    const config = configs[card.plan]
    return config != null && config.product != null && config.product.unlisted !== true
  })
}
