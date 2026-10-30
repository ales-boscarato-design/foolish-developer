import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
    customerEmail: customer === null ? null : OWNER.toUpperCase(),
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
  assert.match(calls[0].url, /depth=1$/)
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
  const doc = privateDoc(42)
  delete (doc as { customerEmail?: string | null }).customerEmail
  const { impl } = stubFetch({ doc: () => jsonResponse(doc) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 404 })
  assert.equal(ownsCustomerFile(null, 42, OWNER), false)
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

test('documento reale con ID numerico del file (non popolato): 502', async () => {
  const { impl } = stubFetch({ doc: () => jsonResponse({ ...privateDoc(), file: 7 }) })
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

test('regola di visibilita account: proprietario, altrui, condiviso e fail-closed', () => {
  assert.equal(ownsCustomerFile(OWNER.toUpperCase(), 42, OWNER), true)
  assert.equal(ownsCustomerFile(OWNER, 42, 'altro@example.test'), false)
  assert.equal(ownsCustomerFile(null, null, OWNER), true)
  assert.equal(ownsCustomerFile(undefined, { id: 42 }, OWNER), false)
})

test('l endpoint documento richiede depth=1 per popolare il file upload', async () => {
  const doc = privateDoc(42)
  delete (doc as { customerEmail?: string | null }).customerEmail
  const { impl, calls } = stubFetch({ doc: () => jsonResponse(doc) })
  const result = await loadCustomerFile({
    cmsUrl: CMS,
    secret: SECRET,
    fileId: 'cf-1',
    sessionEmail: OWNER,
    fetchImpl: impl,
  })
  assert.deepEqual(result, { ok: false, status: 404 }, 'customer resta un ID e senza customerEmail si nega')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${CMS}/api/customer-files/cf-1?depth=1`)
})

test('la lista account usa depth=1 e il filtro condiviso fail-closed', () => {
  const pagePath = new URL('../app/(customer-app)/account/(protected)/file/page.tsx', import.meta.url)
  const page = readFileSync(pagePath, 'utf8')
  assert.ok(page.includes('where[active][equals]=true&limit=50&depth=1'))
  assert.ok(page.includes('allFiles.filter((f) => ownsCustomerFile(f.customerEmail, f.customer, session.email))'))
  assert.ok(!page.includes('f.customer?.email'))
})

test('la guardia account blocca un revert a email relazione o depth=0', () => {
  // La suite copre ownsCustomerFile, ma questa guardia lega l'helper alla pagina reale:
  // senza di essa, un revert del filtro a customer.email resterebbe verde.
  const page = readFileSync(
    new URL('../app/(customer-app)/account/(protected)/file/page.tsx', import.meta.url),
    'utf8'
  ).replace(/\s+/g, ' ')
  assert.ok(page.includes('allFiles.filter((f) => ownsCustomerFile(f.customerEmail, f.customer, session.email))'))
  assert.ok(page.includes('/api/customer-files?where[active][equals]=true&limit=50&depth=1'))
  assert.doesNotMatch(page, /f\.customer\?\.email/)
  assert.doesNotMatch(page, /\.filter\([^)]*customer\.email/)
})

test('il nome file per header non puo iniettare header', () => {
  assert.equal(safeFilenameForHeader('a"b\r\nc.pdf'), 'a_b__c.pdf')
})
