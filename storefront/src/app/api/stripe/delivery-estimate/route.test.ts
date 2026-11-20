import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { estimateCartDelivery } from '@/lib/delivery-estimate'

/**
 * La rotta serve alla pagina ESATTAMENTE la data che `estimateCartDelivery`
 * calcola dai dati del CMS: qui si verifica il passaggio dei dati (durata
 * sconosciuta e durata fuori limite), non il calendario — quello ha i suoi casi
 * nel test della libreria. Per questo la data attesa si ricava dalla stessa
 * funzione: e' lo stesso istante, e il test dice che la rotta non ne calcola
 * una diversa.
 */
test('delivery estimate route resolves CMS production days through the single cart estimate', async () => {
  let productionDays: number | null = null
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/products/1') {
      res.end(JSON.stringify({
        id: 1,
        name: 'Synthetic made-to-order item',
        active: true,
        madeToOrder: true,
        productionDays,
        variants: [{ sku: 'SYNTH-MTO', label: 'Synthetic', price: 10, stockStatus: 'available' }],
      }))
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const previousUrl = process.env.PAYLOAD_PUBLIC_URL
  process.env.PAYLOAD_PUBLIC_URL = `http://127.0.0.1:${port}`
  const request = () => new NextRequest('http://shop.test/api/stripe/delivery-estimate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ country: 'IT', items: [{ productId: '1', sku: 'SYNTH-MTO', quantity: 1 }] }),
  })
  try {
    const { POST } = await import('./route')

    const expected = estimateCartDelivery({ country: 'IT', items: [{ madeToOrder: true, productionDays: null }] })
    const unknownDuration = await POST(request())
    const unknownBody = await unknownDuration.json() as {
      deliveryEstimateDate: string | null; productionDays: number | null; zone: string | null
    }
    assert.equal(unknownDuration.status, 200)
    assert.equal(unknownBody.zone, 'IT_EU')
    assert.equal(unknownBody.productionDays, null, 'durata ignota: nessun numero inventato')
    assert.equal(unknownBody.deliveryEstimateDate, expected.date)

    productionDays = 3_651
    const expectedBounded = estimateCartDelivery({ country: 'IT', items: [{ madeToOrder: true, productionDays: 3_651 }] })
    assert.equal(expectedBounded.reason, 'out_of_bounds')
    const extremeResponse = await POST(request())
    const extremeBody = await extremeResponse.json() as { deliveryEstimateDate: string | null; productionDays: number | null }
    assert.equal(extremeResponse.status, 200)
    assert.equal(extremeBody.deliveryEstimateDate, null, 'nessuna data inventata per una durata CMS fuori dal limite')
    assert.equal(extremeBody.productionDays, null, 'una durata inutilizzabile non si mostra come se fosse una durata')
  } finally {
    if (previousUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = previousUrl
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
