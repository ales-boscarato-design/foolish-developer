import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCustomerFile, ownsCustomerFile, safeFilenameForHeader } from './customer-files'

const CMS = 'https://cms.example.test'
const SECRET = 'synthetic-storefront-secret'
const OWNER = 'cliente-sintetico-a@example.test'

type StubCall = { url: string; init?: RequestInit }

function stubFetch(handlers: {
  doc?: () => Response | Promise<Response>
  file?: () => Response | Promise<Response>
}) {
  const calls: StubCall[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/api/customer-files/')) {
      if (!handlers.doc) throw new Error('nessuno stub per il documento')
      return handlers.doc()
    }
    if (url.includes('/api/media/file/')) {
      if (!handlers.file) throw new Error('nessuno stub per il file')
      return handlers.file()
    }
    throw new Error(`URL inatteso: ${url}`)
  }) as unknown as typeof fetch
  return { impl, calls }
}

function privateDoc(customer: unknown = { id: 3, email: OWNER }) {
  return {
    id: 'cf-1',
    title: 'Documento sintetico',
    active: true,
    customer,
    file: {
      id: 7,
      filename: 'cliente-sintetico-documento.pdf',
      url: 'https://cms.example.test/api/media/file/cliente-sintetico-documento.pdf',
      filesize: 16,
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('proprietario: 200 e byte del documento, secret presentato al CMS', async () => {
  const { impl, calls } = stubFetch({
    doc: () => jsonResponse(privateDoc()),
    file: () =>
      new Response('BYTES-SINTETICI', {
        status: 200,
        headers: { 'content-type': 'application/pdf', 'content-length': '15' },
      }),
  })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.contentType, 'application/pdf')
  assert.equal(result.filename, 'cliente-sintetico-documento.pdf')
  assert.equal(result.filesize, 15)
  assert.equal(await new Response(result.body as BodyInit | null).text(), 'BYTES-SINTETICI')

  assert.equal(calls.length, 2)
  for (const call of calls) {
    const headers = new Headers(call.init?.headers as HeadersInit)
    assert.equal(headers.get('x-storefront-secret'), SECRET, 'ogni chiamata al CMS presenta il secret')
  }
  assert.match(calls[0].url, /\/api\/customer-files\/cf-1\?depth=1$/)
  assert.match(calls[1].url, /\/api\/media\/file\/cliente-sintetico-documento\.pdf$/)
})

test('un altro cliente riceve 404 e i byte non vengono nemmeno chiesti', async () => {
  const { impl, calls } = stubFetch({ doc: () => jsonResponse(privateDoc()) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: 'cliente-sintetico-b@example.test',
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 404 })
  assert.equal(calls.length, 1, 'nessuna richiesta dei byte per un file altrui')
})

test('anonimo (nessuna sessione): 401 senza toccare il CMS', async () => {
  const { impl, calls } = stubFetch({})
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: null,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 401 })
  assert.equal(calls.length, 0)
})

test('documento senza cliente: leggibile da un cliente registrato', async () => {
  const { impl } = stubFetch({
    doc: () => jsonResponse(privateDoc(null)),
    file: () => new Response('BYTES', { status: 200, headers: { 'content-type': 'application/pdf' } }),
  })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: 'qualsiasi-cliente@example.test',
    fetchImpl: impl,
  })
  assert.equal(result.ok, true)
})

test('relazione cliente non risolta (id numerico): nega per fail-closed', async () => {
  const { impl } = stubFetch({ doc: () => jsonResponse(privateDoc(42)) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 404 })
  assert.equal(ownsCustomerFile(42, OWNER), false)
})

test('documento inesistente: 404', async () => {
  const { impl } = stubFetch({ doc: () => jsonResponse({ errors: [] }, 404) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'non-esiste',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 404 })
})

test('errore del CMS sul documento: 502 (distinguibile da lista vuota e da 404)', async () => {
  const { impl } = stubFetch({ doc: () => jsonResponse({ errors: [] }, 500) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 502 })
})

test('byte negati dal CMS (403 sul media): 502, non un 403 al cliente', async () => {
  const { impl } = stubFetch({
    doc: () => jsonResponse(privateDoc()),
    file: () => new Response(null, { status: 403 }),
  })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 502 })
})

test('rete assente: 502', async () => {
  const impl = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 502 })
})

test('relazione file non risolta: 502 e non un download sbagliato', async () => {
  const doc = { ...privateDoc(), file: 7 }
  const { impl } = stubFetch({ doc: () => jsonResponse(doc) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 502 })
})

test('il nome file per header non puo iniettare header', () => {
  assert.equal(safeFilenameForHeader('a"b\r\nc.pdf'), 'a_b__c.pdf')
})
