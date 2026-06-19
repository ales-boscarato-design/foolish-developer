import { NextRequest, NextResponse } from 'next/server'
import { fetchResellerProducts, fetchResellerProductBySlug } from '@/lib/cms'
import { routing } from '@/i18n/routing'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  const localeParam = req.nextUrl.searchParams.get('locale')
  const cookieLocale = req.cookies.get('NEXT_LOCALE')?.value
  const locale = (routing.locales as readonly string[]).includes(localeParam ?? '') ? localeParam!
    : (routing.locales as readonly string[]).includes(cookieLocale ?? '') ? cookieLocale!
    : routing.defaultLocale

  if (slug) {
    const product = await fetchResellerProductBySlug(slug, locale)
    if (!product) return NextResponse.json(null, { status: 404 })
    return NextResponse.json(product)
  }

  const products = await fetchResellerProducts(locale)
  return NextResponse.json(products)
}
