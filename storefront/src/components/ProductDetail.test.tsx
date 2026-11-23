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
    box: {
      title: 'Contenuto',
      sheet: { label: 'Synthetic sheet', description: 'Synthetic sheet description' },
      techCard: { label: 'Synthetic tech card', description: 'Synthetic tech card description' },
      certificate: { label: 'Synthetic certificate', description: 'Synthetic certificate description' },
    },
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

  // Il fallback non è più testo scritto nel componente: arriva dalle chiavi `product.box.*`.
  // Restano invariati i tre elementi, il loro ordine e il fatto che ognuno compaia una volta sola.
  const expected = [
    'Synthetic sheet',
    'Synthetic sheet description',
    'Synthetic tech card',
    'Synthetic tech card description',
    'Synthetic certificate',
    'Synthetic certificate description',
  ]

  const positions = expected.map((text) => section.indexOf(text))
  for (const [i, position] of positions.entries()) assert.ok(position >= 0, `manca "${expected[i]}" nel fallback`)
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'ordine del fallback cambiato')

  // Una volta sola, come testo di un elemento: le descrizioni contengono le etichette come sottostringa.
  for (const text of expected) {
    const occurrences = (section.match(new RegExp(`>${text}<`, 'g')) ?? []).length
    assert.equal(occurrences, 1, `"${text}" compare ${occurrences} volte`)
  }
})
