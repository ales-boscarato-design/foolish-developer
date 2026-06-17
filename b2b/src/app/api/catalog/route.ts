import { NextRequest, NextResponse } from 'next/server'
import { fetchResellerProducts, fetchResellerProductBySlug } from '@/lib/cms'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')

  if (slug) {
    const product = await fetchResellerProductBySlug(slug)
    if (!product) return NextResponse.json(null, { status: 404 })
    return NextResponse.json(product)
  }

  const products = await fetchResellerProducts()
  return NextResponse.json(products)
}
