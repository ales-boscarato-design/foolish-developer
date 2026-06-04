export const dynamic = 'force-dynamic'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getProductBySlug } from '@/lib/cms'
import { ProductDetail } from '@/components/ProductDetail'
import { getPublishedReviewsByProduct, getReviewSummary } from '@/lib/reviews-db'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

interface Props {
  params: Promise<{ slug: string; locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, locale } = await params
  const product = await getProductBySlug(slug, locale)
  if (!product) return {}

  const firstImage = product.images?.[0]?.image?.url
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/prodotto/${slug}`]))

  return {
    title: product.name,
    description: product.shortDescription,
    alternates: {
      canonical: `${BASE}/${locale}/prodotto/${slug}`,
      languages: { ...langs, 'x-default': `${BASE}/it/prodotto/${slug}` },
    },
    openGraph: {
      title: `${product.name} — The Foolish Butcher`,
      description: product.shortDescription ?? undefined,
      url: `${BASE}/${locale}/prodotto/${slug}`,
      type: 'website',
      images: firstImage
        ? [{ url: firstImage, width: 1200, height: 630, alt: product.name }]
        : undefined,
    },
  }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const locale = await getLocale()
  const product = await getProductBySlug(slug, locale)
  if (!product) notFound()

  const [reviews, reviewSummary] = await Promise.all([
    getPublishedReviewsByProduct(slug, 5),
    getReviewSummary(slug),
  ])

  const firstImage = product.images?.[0]?.image?.url
  const lowestPrice = product.variants?.reduce(
    (min, v) => (v.price < min ? v.price : min),
    product.basePrice,
  ) ?? product.basePrice

  const productSchema = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.shortDescription,
    image: firstImage,
    brand: { '@type': 'Brand', name: 'The Foolish Butcher' },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      price: lowestPrice.toFixed(2),
      availability: 'https://schema.org/InStock',
      url: `${BASE}/${locale}/prodotto/${slug}`,
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <ProductDetail product={product} reviews={reviews} reviewSummary={reviewSummary} />
    </>
  )
}
