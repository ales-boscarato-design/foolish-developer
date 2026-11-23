import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import test from 'node:test'
import type { Product } from '@/lib/cms'
import { ProductDetail } from './ProductDetail'

const messages = {
  product: {
    sectionTattoo: 'Tattoo',
    sectionMerch: 'Merch',
    sectionPmu: 'PMU',
    noImage: 'No image',
    vatIncluded: 'VAT included',
    variantLabel: 'Variant',
    addToCart: 'Add to cart',
  },
}

function renderProduct(whatsInTheBox?: Product['whatsInTheBox']) {
  const product: Product = {
    id: 'synthetic-product',
    name: 'Synthetic product',
    slug: 'synthetic-product',
    section: 'tattoo',
    active: true,
    limitedStock: false,
    order: 1,
    images: [],
    basePrice: 10,
    variants: [{ sku: 'SYN-1', label: 'Synthetic variant', price: 10, stockStatus: 'available', validCombinations: [] }],
    attributes: [],
    whatsInTheBox,
  }

  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProductDetail product={product} />
    </NextIntlClientProvider>,
  )
}

function contentSection(markup: string) {
  const sections = [...markup.matchAll(/<section\b[\s\S]*?<\/section>/g)].map(([section]) => section)
  const section = sections.find((candidate) => candidate.includes('Contenuto'))
  assert.ok(section, 'ProductDetail should render its Contenuto section')
  return section
}

test('ProductDetail Contenuto renders identical label and description only once', () => {
  const section = contentSection(renderProduct([
    { label: 'Synthetic identical entry', description: 'Synthetic identical entry' },
  ]))

  assert.equal((section.match(/Synthetic identical entry/g) ?? []).length, 1)
  assert.match(section, /<span class="text-sm font-semibold"[^>]*>Synthetic identical entry<\/span>/)
  assert.doesNotMatch(section, /<p\b/)
})

test('ProductDetail Contenuto retains distinct entries in source order', () => {
  const section = contentSection(renderProduct([
    { label: 'Synthetic first label', description: 'Synthetic first description' },
    { label: 'Synthetic second label', description: 'Synthetic second description' },
  ]))

  const expectedOrder = [
    'Synthetic first label',
    'Synthetic first description',
    'Synthetic second label',
    'Synthetic second description',
  ]
  assert.deepEqual(
    expectedOrder.map((value) => section.indexOf(value)),
    [...expectedOrder].map((value) => section.indexOf(value)).sort((a, b) => a - b),
  )
  for (const value of expectedOrder) assert.equal((section.match(new RegExp(value, 'g')) ?? []).length, 1)
})

test('ProductDetail Contenuto omits absent and whitespace-only descriptions', () => {
  const section = contentSection(renderProduct([
    { label: 'Synthetic missing description' },
    { label: 'Synthetic empty description', description: '' },
    { label: 'Synthetic whitespace description', description: ' \n\t ' },
  ] as Product['whatsInTheBox']))

  for (const label of ['Synthetic missing description', 'Synthetic empty description', 'Synthetic whitespace description']) {
    assert.equal((section.match(new RegExp(label, 'g')) ?? []).length, 1)
  }
  assert.doesNotMatch(section, /<p\b/)
  assert.doesNotMatch(section, />\s*<\/p>/)
})

test('ProductDetail Contenuto fallback remains unchanged when no entries are supplied', () => {
  const section = contentSection(renderProduct([]))

  for (const text of [
    'Foglio sintetico',
    '1x foglio nelle dimensioni selezionate',
    'Scheda tecnica',
    'Codice seriale, specifiche materiale, istruzioni utilizzo',
    'Certificato',
    'Attestazione materiale atossico e origine italiana',
  ]) {
    assert.equal((section.match(new RegExp(text, 'g')) ?? []).length, 1)
  }
})
