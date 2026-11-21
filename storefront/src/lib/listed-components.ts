import type { ProductComponent, ProductVariant } from './cms'

export function listedComponents(components: ProductComponent[] | undefined): ProductComponent[] {
  return (components ?? []).filter((component) => component.unlisted !== true)
}

export function addListedComponent(
  component: ProductComponent,
  variant: ProductVariant | undefined,
  add: (product: ProductComponent, variant: ProductVariant, attrs: Record<string, string>) => void,
): boolean {
  if (component.unlisted === true || !variant) return false
  add(component, variant, {})
  return true
}