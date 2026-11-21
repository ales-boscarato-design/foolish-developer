export function subscriptionCheckoutError(data: unknown, unlistedMessage: string): string | null {
  if (!data || typeof data !== 'object') return null
  return (data as { error?: unknown }).error === 'product_unlisted' ? unlistedMessage : null
}
