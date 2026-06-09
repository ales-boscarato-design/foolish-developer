import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { addToWishlist, removeFromWishlist } from '@/lib/account-db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { product_slug, product_name, product_price } = await req.json()
  if (!product_slug || !product_name) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  await addToWishlist(session.email, { product_slug, product_name, product_price })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const slug = searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 })

  await removeFromWishlist(session.email, slug)
  return NextResponse.json({ ok: true })
}
