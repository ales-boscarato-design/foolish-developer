import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * Il proxy /cms-media esiste per le immagini di catalogo pubbliche. Non deve MAI rendere
 * memorizzabile la risposta di un file che il CMS nega (documento privato): l'upstream
 * risponde 403 senza credenziali e la risposta deve arrivare al client senza cache pubblica.
 */

type FetchStub = { url: string; headers: Headers | null }

function installStub(response: () => Response) {
  const calls: FetchStub[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init?.headers ? new Headers(init.headers as HeadersInit) : null,
    })
    return response()
  }) as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

async function callProxy(path: string[]) {
  // import dinamico: il modulo legge le env solo dentro l'handler
  const { GET } = await import('../app/cms-media/[...path]/route')
  const req = { headers: new Headers() } as unknown as Request
  return GET(req as never, { params: Promise.resolve({ path }) })
}

test('immagine pubblica: cache pubblica immutabile e nessuna credenziale inoltrata', async () => {
  const stub = installStub(
    () =>
      new Response('IMG', {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '3' },
      }),
  )
  try {
    const res = await callProxy(['pubblico-sintetico.png'])
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(stub.calls.length, 1)
    assert.match(stub.calls[0].url, /\/api\/media\/file\/pubblico-sintetico\.png$/)
    const forwarded = stub.calls[0].headers
    assert.equal(forwarded?.get('x-storefront-secret'), null)
    assert.equal(forwarded?.get('authorization'), null)
  } finally {
    stub.restore()
  }
})

test('file privato negato dal CMS (403): lo status passa e la risposta NON e memorizzabile', async () => {
  const stub = installStub(() => new Response(null, { status: 403 }))
  try {
    const res = await callProxy(['cliente-sintetico-documento.pdf'])
    assert.equal(res.status, 403)
    const cacheControl = res.headers.get('cache-control') ?? ''
    assert.ok(!/public/.test(cacheControl), `cache-control non deve essere pubblico: "${cacheControl}"`)
    assert.equal(cacheControl, 'no-store')
    assert.equal(await res.text(), '')
  } finally {
    stub.restore()
  }
})

test('il proxy non inoltra mai il secret dello storefront', async () => {
  process.env.PAYLOAD_API_SECRET = 'synthetic-storefront-secret'
  const stub = installStub(() => new Response('IMG', { status: 200, headers: { 'content-type': 'image/png' } }))
  try {
    await callProxy(['pubblico-sintetico.png'])
    const forwarded = stub.calls[0].headers
    assert.equal(forwarded?.get('x-storefront-secret'), null)
  } finally {
    stub.restore()
  }
})
