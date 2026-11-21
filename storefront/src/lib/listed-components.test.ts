import assert from 'node:assert/strict'
import test from 'node:test'
import type { ProductComponent, ProductVariant } from './cms'
import { addListedComponent, listedComponents } from './listed-components'

const variant: ProductVariant = {
  sku: 'SKU-1', label: 'Standard', price: 10, stockStatus: 'available', validCombinations: [],
}
const listed: ProductComponent = {
  id: 'listed', name: 'Listed', slug: 'listed', basePrice: 10, images: [], variants: [variant], unlisted: false,
}
const hidden: ProductComponent = { ...listed, id: 'hidden', slug: 'hidden', unlisted: true }

test('ProductDetail component list and add-to-cart guard exclude unlisted products', () => {
  assert.deepEqual(listedComponents([listed, hidden]).map((component) => component.id), ['listed'])
  assert.deepEqual(listedComponents([hidden]), [])

  const cartAdds: string[] = []
  const add = (product: ProductComponent) => cartAdds.push(product.id)
  assert.equal(addListedComponent(hidden, variant, add), false)
  assert.deepEqual(cartAdds, [], 'unlisted component must not reach the cart')
  assert.equal(addListedComponent(listed, variant, add), true)
  assert.deepEqual(cartAdds, ['listed'], 'listed component still reaches the cart')
  assert.equal(addListedComponent(listed, undefined, add), false)
  assert.deepEqual(cartAdds, ['listed'], 'missing variant must not reach the cart')
})
