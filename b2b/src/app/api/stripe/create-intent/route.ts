import { NextRequest } from 'next/server'
import { handleCreateIntent, realCheckoutDeps } from '@/lib/b2b-checkout'

/**
 * POST /api/stripe/create-intent — ordine con carta.
 *
 * Stesso preflight della rotta bonifico (sessione, VIES, catalogo
 * autorevole, totali) e poi ordine CMS + PaymentIntent. Il filo resta qui,
 * la logica in `handleCreateIntent`.
 */
export async function POST(req: NextRequest) {
  return handleCreateIntent(req, realCheckoutDeps)
}
