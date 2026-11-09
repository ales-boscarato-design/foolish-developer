import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'

import { fetchResellerCatalog } from './cms'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
  delete process.env.B2B_CATALOG_TIMEOUT_MS
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function catalogBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    docs: [{ id: 1, slug: 'a', name: 'A', resellerVisible: true, priceTiers: [], variants: [] }],
    totalDocs: 1,
    hasNextPage: false,
    ...overrides,
  }
}

function respond(body: unknown): void {
  globalThis.fetch = (async () => jsonResponse(body)) as typeof fetch
}

async function expectCatalogError(expected: string): Promise<void> {
  await assert.rejects(fetchResellerCatalog(), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, expected)
    return true
  })
}

test('hasNextPage true e totalDocs assente: catalogo_incompleto', async () => {
  respond({ docs: catalogBody().docs, hasNextPage: true })
  await expectCatalogError('catalogo_incompleto')
})

test('docs.length diverso da totalDocs: catalogo_incompleto', async () => {
  respond(catalogBody({ totalDocs: 2 }))
  await expectCatalogError('catalogo_incompleto')
})

test('documento con resellerVisible assente: catalogo_incompleto', async () => {
  respond(catalogBody({
    docs: [{ id: 1, slug: 'a', name: 'A', priceTiers: [], variants: [] }],
  }))
  await expectCatalogError('catalogo_incompleto')
})

test('documento con resellerVisible false: catalogo_incompleto', async () => {
  respond(catalogBody({
    docs: [{ id: 1, slug: 'a', name: 'A', resellerVisible: false, priceTiers: [], variants: [] }],
  }))
  await expectCatalogError('catalogo_incompleto')
})

test('risposta valida: array di prodotti', async () => {
  respond(catalogBody())
  const catalog = await fetchResellerCatalog()
  assert.equal(catalog.length, 1)
  assert.equal(catalog[0].resellerVisible, true)
})

test('corpo che non termina mai: catalogo_non_disponibile entro un secondo', async () => {
  process.env.B2B_CATALOG_TIMEOUT_MS = '50'
  globalThis.fetch = (async () => new Response(new ReadableStream({
    start() {
      // Non si chiude e non produce mai nulla: la lettura resta appesa.
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const started = Date.now()
  await expectCatalogError('catalogo_non_disponibile')
  assert.ok(Date.now() - started < 1000)
})
