export const dynamic = 'force-dynamic'
import { getTranslations } from 'next-intl/server'
import { getLimitedProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { redirect } from 'next/navigation'

export async function generateMetadata() {
  const t = await getTranslations('sections.limited')
  return { title: t('meta') }
}

export default async function LimitedPage() {
  const t = await getTranslations('sections.limited')
  const products = await getLimitedProducts()
  if (products.length === 0) redirect('/')
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-10">
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--limited)' }}>{t('badge')}</span>
        <h1 className="text-3xl font-bold mt-2">{t('title')}</h1>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-fg)' }}>{t('description')}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  )
}
