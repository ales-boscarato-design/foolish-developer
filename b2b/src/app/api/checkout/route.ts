import { NextRequest } from 'next/server'
import { handleCheckout, realCheckoutDeps } from '@/lib/b2b-checkout'

/**
 * POST /api/checkout — ordine con bonifico.
 *
 * Tutta la logica (sessione, VIES, catalogo autorevole, totali, ordine CMS)
 * vive in `handleCheckout`, condivisa con la rotta Stripe. Qui resta solo il
 * filo: la rotta e' il punto in cui Next entra, e i test possono chiamarla
 * come la chiama Next (`POST(new NextRequest(...))`) senza riscrivere il
 * percorso.
 */
export async function POST(req: NextRequest) {
  return handleCheckout(req, realCheckoutDeps)
}
