import { NextRequest, NextResponse } from 'next/server'
import {
  PRODUCTION_QUEUE_MAX_SKUS,
  normalizeQueueSkus,
  readProductionQueueEstimate,
  toPublicProductionQueueEstimate,
} from '@/lib/production-queue-service'

/**
 * GET /api/produzione/coda?sku=<sku>[&sku=<sku>...]
 *
 * Contratto unico per scheda prodotto, carrello e checkout: uno o piu' SKU (per
 * il carrello tutte le righe, righe pack comprese) e in risposta la stima della
 * coda di produzione.
 *
 * Regola di lettura per il chiamante: `state: 'ok'` e' l'unico caso in cui si
 * puo' mostrare una data derivata dalla coda. `state: 'unavailable'` NON
 * significa "coda vuota": significa "stima non disponibile", e mostrare la data
 * base in quel caso e' piu' ottimistico della realta'.
 *
 * Lo stato HTTP e' 200 anche per `unavailable`: l'errore del CMS e' un valore
 * del contratto, non un guasto della rotta. Il 400 e' riservato a una richiesta
 * sintatticamente sbagliata (nessuno SKU, troppi SKU, SKU vuoto).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

function badRequest(detail: string) {
  return NextResponse.json(
    { state: 'unavailable', reason: 'invalid_payload', detail },
    { status: 400, headers: NO_STORE },
  )
}

export async function GET(req: NextRequest) {
  const rawSkus = req.nextUrl.searchParams.getAll('sku')
  if (rawSkus.length === 0) return badRequest('sku_missing')
  if (rawSkus.length > PRODUCTION_QUEUE_MAX_SKUS) return badRequest('too_many_skus')
  if (normalizeQueueSkus(rawSkus) === null) return badRequest('sku_invalid')

  const estimate = await readProductionQueueEstimate({ skus: rawSkus })
  // Proiezione pubblica: la rotta e' raggiungibile da chiunque, quindi non esce
  // il dettaglio operativo (pezzi per formato, SKU fuori catalogo, ordini
  // esclusi con i loro numeri).
  return NextResponse.json(toPublicProductionQueueEstimate(estimate), { headers: NO_STORE })
}
