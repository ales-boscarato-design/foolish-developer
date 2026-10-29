import assert from 'node:assert/strict'
import test from 'node:test'

import { useCart, type CartItem } from './cart'

function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    productId: 1,
    productSlug: 'stencil-test',
    productName: 'Stencil Test (sintetico)',
    variantSku: 'ST-01',
    variantLabel: 'Standard',
    unitPrice: 0.01,
    qty: 1,
    priceTiers: [{ minQty: 1, maxQty: null, discountPercent: 50 }],
    ...overrides,
  }
}

test('due righe da 0.01 al 50%: total() e 0.02, non 0.01', () => {
  useCart.setState({ items: [item(), item({ variantSku: 'ST-02' })] })
  assert.equal(useCart.getState().total(), 0.02)
})

test('una riga da 14.99 senza fasce: total() e 14.99', () => {
  useCart.setState({ items: [item({ unitPrice: 14.99, priceTiers: [] })] })
  assert.equal(useCart.getState().total(), 14.99)
})
