import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, test } from 'node:test'

const BASE_URL = 'https://thefoolishbutcher.com'
const BASE_PRODUCT_SLUG = 't-sheet-dbl'
const INACTIVE_DUPLICATE_SLUG = 't-sheet-dbl-abbonamento'

let server: ReturnType<typeof createServer> | undefined
let baseUrl = ''
let activeFilter: string | null = null

async function startFakeCms() {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    activeFilter = url.searchParams.get('where[active][equals]')
    const products = [
      { id: '33', slug: BASE_PRODUCT_SLUG, active: true },
      { id: '56', slug: INACTIVE_DUPLICATE_SLUG, active: false },
    ]
    const docs = activeFilter === 'true' ? products.filter((product) => product.active) : products
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ docs }))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server!.address()
  if (!address || typeof address === 'string') throw new Error('fake CMS did not bind a port')
  baseUrl = `http://127.0.0.1:${address.port}`
  process.env.PAYLOAD_PUBLIC_URL = baseUrl
}

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()))
})

test('sitemap requests active products and includes the base product, not the inactive duplicate', async () => {
  await startFakeCms()
  const { default: sitemap } = await import('./sitemap')
  const entries = await sitemap()

  assert.equal(activeFilter, 'true', `expected fake CMS request to include active=true (CMS: ${baseUrl})`)
  const urls = entries.map((entry) => entry.url)
  for (const locale of ['it', 'en', 'fr', 'es', 'de']) {
    assert.ok(urls.includes(`${BASE_URL}/${locale}/prodotto/${BASE_PRODUCT_SLUG}`), `${locale} base product present`)
    assert.ok(!urls.includes(`${BASE_URL}/${locale}/prodotto/${INACTIVE_DUPLICATE_SLUG}`), `${locale} inactive duplicate absent`)
  }
})
