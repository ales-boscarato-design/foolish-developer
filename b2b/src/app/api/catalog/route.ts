import { NextRequest, NextResponse } from 'next/server'
import { fetchResellerProducts, fetchResellerProductBySlug } from '@/lib/cms'

const VALID_LOCALES = ['it', 'fr', 'en', 'es']

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  const localeParam = req.nextUrl.searchParams.get('locale')
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  const locale = VALID_LOCALES.includes(localeParam ?? '') ? localeParam!
    : VALID_LOCALES.includes(cookieLocale ?? '') ? cookieLocale!
    : 'it'

  if (slug) {
    const product = await fetchResellerProductBySlug(slug, locale)
    if (!product) return NextResponse.json(null, { status: 404 })
    return NextResponse.json(product)
  }

  const products = await fetchResellerProducts(locale)
  return NextResponse.json(products)
}
