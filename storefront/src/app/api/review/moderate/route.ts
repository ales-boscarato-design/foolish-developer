import { NextRequest, NextResponse } from 'next/server'
import { publishReview, removeReview, getReviewById } from '@/lib/reviews-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function html(title: string, message: string, color: string): NextResponse {
  const icon = color === '#c8a97e' ? '✅' : '🗑'
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{font-family:Georgia,serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{text-align:center;padding:48px 32px;max-width:400px}.icon{font-size:48px;margin-bottom:16px}
    h1{font-size:24px;color:${color};margin:0 0 12px}p{color:#6b6560;font-size:14px}</style></head>
    <body><div class="card"><div class="icon">${icon}</div>
    <h1>${title}</h1><p>${message}</p></div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const action = searchParams.get('action')
  const token = searchParams.get('token')

  if (!id || !action || !token) {
    return html('Parametri mancanti', 'Link non valido.', '#888')
  }
  if (token !== process.env.REVIEW_ADMIN_SECRET) {
    return html('Non autorizzato', 'Token non valido.', '#888')
  }
  if (action !== 'publish' && action !== 'remove') {
    return html('Azione non valida', 'Usa publish o remove.', '#888')
  }

  const review = await getReviewById(id)
  if (!review) {
    return html('Review non trovata', `ID: ${id}`, '#888')
  }
  if (review.status !== 'pending') {
    return html(
      'Già moderata',
      `Questa review è già in stato "${review.status}".`,
      '#888',
    )
  }

  if (action === 'publish') {
    await publishReview(id)
    return html('Pubblicata', `Review di ${review.reviewer_name ?? 'anonimo'} (★${review.rating}) pubblicata.`, '#c8a97e')
  } else {
    await removeReview(id)
    return html('Rimossa', `Review rimossa.`, '#888')
  }
}
