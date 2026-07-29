import { NextRequest, NextResponse } from 'next/server'
import { checkVatNumber } from '@/lib/vies'

/**
 * Verifica una partita IVA contro il VIES.
 *
 * Chiamata dal checkout quando il campo perde il focus, così il
 * rivenditore vede subito la ragione sociale ufficiale comparire sotto
 * il campo — è una conferma, non un interrogatorio.
 *
 * Risponde sempre 200: `status` porta l'esito. Un 4xx/5xx qui
 * verrebbe letto dal client come "errore di rete" e trattato come
 * `unverified`, che è già il fallback corretto — ma è meglio che sia
 * esplicito.
 */
export async function POST(req: NextRequest) {
  let vat = ''
  try {
    const body = await req.json()
    vat = typeof body?.vat === 'string' ? body.vat : ''
  } catch {
    return NextResponse.json({ status: 'invalid', detail: 'body non valido' })
  }
  if (!vat.trim()) {
    return NextResponse.json({ status: 'invalid', detail: 'partita IVA mancante' })
  }
  const result = await checkVatNumber(vat)
  return NextResponse.json(result)
}
