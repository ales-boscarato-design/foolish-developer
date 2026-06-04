import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { unsubscribeById, getSubscriberById } from '@/lib/marketing-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')

  if (!token) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  try {
    const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_SECRET!)
    const { payload } = await jwtVerify(token, secret)

    const subscriberId = payload.subscriberId as string
    const email = payload.email as string

    if (!subscriberId || !email) {
      return new NextResponse('Link non valido.', { status: 400 })
    }

    const subscriber = await getSubscriberById(subscriberId)
    if (!subscriber || subscriber.email !== email) {
      return new NextResponse('Link non valido.', { status: 400 })
    }

    if (subscriber.status === 'unsubscribed') {
      return new NextResponse(
        '<html><body style="font-family:Georgia,serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><p style="color:#c8a97e;letter-spacing:.1em;text-transform:uppercase;font-size:12px">The Foolish Butcher</p><h1 style="font-size:24px;margin:16px 0">Già cancellato.</h1><p style="color:#6b6560">Non riceverai altre email da noi.</p></div></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }

    await unsubscribeById(subscriberId)

    return new NextResponse(
      '<html><body style="font-family:Georgia,serif;background:#0a0a0a;color:#f0ede8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><p style="color:#c8a97e;letter-spacing:.1em;text-transform:uppercase;font-size:12px">The Foolish Butcher</p><h1 style="font-size:24px;margin:16px 0">Cancellato.</h1><p style="color:#6b6560">Non riceverai altre email da noi. Nessuna conferma richiesta.</p></div></body></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    )
  } catch {
    return new NextResponse('Link scaduto o non valido.', { status: 400 })
  }
}
