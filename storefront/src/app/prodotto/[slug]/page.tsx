export const dynamic = 'force-dynamic'
import { notFound } from 'next/navigation'
import { getProductBySlug, getProducts } from '@/lib/cms'
import { ProductDetail } from '@/components/ProductDetail'

interface Props {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  const products = await getProducts()
  return products.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product) return {}
  return {
    title: `${product.name} — The Foolish Butcher`,
    description: product.shortDescription,
  }
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params
  const product = await getProductBySlug(slug)
  if (!product || !product.active) notFound()
  return <ProductDetail product={product} />
}
