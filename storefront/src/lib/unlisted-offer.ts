export function offerProductIfListed<T extends { unlisted?: boolean }>(product: T | null | undefined): T | null {
  return product && product.unlisted !== true ? product : null
}
