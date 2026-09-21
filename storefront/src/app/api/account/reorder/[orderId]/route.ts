import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { handleReorderRequest } from '@/lib/reorder-route'

export const dynamic = 'force-dynamic'

/**
 * Riordina un ordine passato: apre una sessione di pagamento con le stesse righe
 * prodotto, la spedizione calcolata sulla destinazione reale dell'ordine e
 * l'indirizzo raccolto da Stripe.
 *
 * Il corpo sta in `@/lib/reorder-route`: qui l'unico passo possibile e'
 * l'autenticazione, perche' i cookie del contesto richiesta di Next non esistono
 * in un test Node, e il percorso che tocca i soldi deve restare verificabile.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  void req
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orderId } = await params
  return handleReorderRequest(orderId, session.email)
}
