export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { getProductBySlug } from '@/lib/cms'
import { ProductDetail } from '@/components/ProductDetail'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const locale = await getLocale()
  const product = await getProductBySlug(slug, locale)
  if (!product) return {}
  return {
    title: `${product.name} — The Foolish Butcher`,
    description: product.shortDescription,
  }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const locale = await getLocale()
  const product = await getProductBySlug(slug, locale)
  if (!product || !product.active) notFound()
  return <ProductDetail product={product} />
}
