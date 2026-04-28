export const dynamic = 'force-dynamic'
import { getTranslations } from 'next-intl/server'
import { getProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export async function generateMetadata() {
  const t = await getTranslations('sections.tattoo')
  return { title: t('meta') }
}

export default async function TattooPage() {
  const t = await getTranslations('sections')
  const products = await getProducts('tattoo')
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-10">
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--muted-fg)' }}>{t('label')}</p>
        <h1 className="text-3xl font-bold">{t('tattoo.title')}</h1>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-fg)' }}>{t('tattoo.description')}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
  )
}
