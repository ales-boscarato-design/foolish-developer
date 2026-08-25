export function getB2BOrderNumber(metadata: Record<string, string> | null | undefined): string | null {
  const orderNumber = metadata?.orderNumber
  return typeof orderNumber === 'string' && orderNumber.trim().length > 0
    ? orderNumber
    : null
}
