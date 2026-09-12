import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCheckoutCatalog, type CatalogProductFetcher } from './catalog'

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: 'product-1',
    name: 'CMS Product',
    active: true,
    variants: [{
      sku: 'SKU-1',
      label: 'CMS Variant',
      price: 10.01,
      stockStatus: 'available',
    }],
    packs: [{
      id: 'pack-3',
      name: 'CMS Pack',
      quantity: 3,
      discountPercent: 15,
    }],
    ...overrides,
  }
}

function fetchProduct(document: unknown): CatalogProductFetcher {
  return async () => ({ status: 'found', product: document })
}

test('ignores stale client price and labels in favour of CMS values', async () => {
  const result = await resolveCheckoutCatalog([{
    productId: 'product-1',
    sku: 'SKU-1',
    quantity: 1,
    price: 0.01,
    productName: 'Tampered name',
    variantLabel: 'Tampered variant',
  }], { fetchProduct: fetchProduct(product()) })

  assert.deepEqual(result, {
    status: 'ok',
    items: [{
      productName: 'CMS Product',
      variantLabel: 'CMS Variant',
      price: 10.01,
      quantity: 1,
      sku: 'SKU-1',
    }],
  })
})

test('uses SKU fallback only when productId is absent for a legacy item', async () => {
  let lookup: { productId?: string; sku?: string } | undefined
  const result = await resolveCheckoutCatalog([{
    sku: 'SKU-1',
    quantity: 1,
  }], {
    fetchProduct: async (query) => {
      lookup = query
      return { status: 'found', product: product() }
    },
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(lookup, { sku: 'SKU-1' })
})

test('resolves a numeric productId and normalizes it for lookup and identity comparison', async () => {
  let lookup: { productId?: string; sku?: string } | undefined
  const result = await resolveCheckoutCatalog([{
    productId: 123,
    sku: 'SKU-1',
    quantity: 1,
  }], {
    fetchProduct: async (query) => {
      lookup = query
      return { status: 'found', product: product({ id: 123 }) }
    },
  })

  assert.equal(result.status, 'ok')
  assert.deepEqual(lookup, { productId: '123' })
})

test('rejects malformed numeric and object productIds', async () => {
  for (const productId of [1.5, -1, Number.MAX_SAFE_INTEGER + 1, true, {}, '']) {
    const result = await resolveCheckoutCatalog([{
      productId,
      sku: 'SKU-1',
      quantity: 1,
    }], { fetchProduct: fetchProduct(product()) })

    assert.equal(result.status, 'invalid', `productId ${String(productId)} should be invalid`)
  }
})

test('rejects a SKU that does not belong to the requested product', async () => {
  const result = await resolveCheckoutCatalog([{
    productId: 'product-1',
    sku: 'OTHER-SKU',
    quantity: 1,
  }], { fetchProduct: fetchProduct(product()) })

  assert.equal(result.status, 'invalid')
})

test('rejects inactive products and unavailable variants', async () => {
  const inactive = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 1,
  }], { fetchProduct: fetchProduct(product({ active: false })) })
  const unavailable = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 1,
  }], {
    fetchProduct: fetchProduct(product({
      variants: [{ ...product().variants[0], stockStatus: 'unavailable' }],
    })),
  })

  assert.equal(inactive.status, 'invalid')
  assert.equal(unavailable.status, 'invalid')
})

test('rejects quantities over the current limitedQty bound', async () => {
  const result = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 3,
  }], {
    fetchProduct: fetchProduct(product({
      variants: [{ ...product().variants[0], limitedQty: 2 }],
    })),
  })

  assert.equal(result.status, 'invalid')
})

test('rejects non-positive and unsafe CMS prices', async () => {
  const zero = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 1,
  }], {
    fetchProduct: fetchProduct(product({
      variants: [{ ...product().variants[0], price: 0 }],
    })),
  })
  const unsafe = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 1,
  }], {
    fetchProduct: fetchProduct(product({
      variants: [{ ...product().variants[0], price: Number.MAX_VALUE }],
    })),
  })

  assert.equal(zero.status, 'unavailable')
  assert.equal(unsafe.status, 'unavailable')
})

test('resolves a normal variant price from CMS', async () => {
  const result = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 2,
  }], { fetchProduct: fetchProduct(product()) })

  assert.equal(result.status, 'ok')
  if (result.status !== 'ok') return
  assert.equal(result.items[0]?.price, 10.01)
  assert.equal(result.items[0]?.quantity, 2)
})

test('resolves a valid pack with CMS discount and preserves the pack SKU', async () => {
  const result = await resolveCheckoutCatalog([{
    productId: 'product-1',
    sku: 'SKU-1-pack-pack-3',
    quantity: 6,
    price: 999,
    packName: 'Tampered pack',
    originalUnitPrice: 999,
  }], { fetchProduct: fetchProduct(product()) })

  assert.deepEqual(result, {
    status: 'ok',
    items: [{
      productName: 'CMS Product',
      variantLabel: 'CMS Variant',
      price: 8.51,
      quantity: 6,
      sku: 'SKU-1-pack-pack-3',
    }],
  })
})

test('rejects tampered or stale pack IDs and pack quantity assumptions', async () => {
  const wrongId = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1-pack-other-pack', quantity: 3,
  }], { fetchProduct: fetchProduct(product()) })
  const wrongMultiple = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1-pack-pack-3', quantity: 4,
  }], { fetchProduct: fetchProduct(product()) })

  assert.equal(wrongId.status, 'invalid')
  assert.equal(wrongMultiple.status, 'invalid')
})

test('maps a CMS fetch failure to catalog unavailable', async () => {
  const result = await resolveCheckoutCatalog([{
    productId: 'product-1', sku: 'SKU-1', quantity: 1,
  }], {
    fetchProduct: async () => {
      throw new Error('CMS unavailable')
    },
  })

  assert.equal(result.status, 'unavailable')
})
