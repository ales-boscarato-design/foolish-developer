export const dynamic = 'force-dynamic'
import type { Metadata } from 'next'
import { getTranslations, getLocale } from 'next-intl/server'
import { getProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations('sections.pmu')
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/pmu`]))
  return {
    title: t('meta'),
    alternates: {
      canonical: `${BASE}/${locale}/pmu`,
      languages: { ...langs, 'x-default': `${BASE}/it/pmu` },
    },
  }
}

export default async function PmuPage() {
  const t = await getTranslations('sections')
  const locale = await getLocale()
  const products = await getProducts('pmu', locale)
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/${locale}` },
      { '@type': 'ListItem', position: 2, name: 'PMU Practice Skin', item: `${BASE}/${locale}/pmu` },
    ],
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-10">
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--muted-fg)' }}>{t('label')}</p>
        <h1 className="text-3xl font-bold">{t('pmu.title')}</h1>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-fg)' }}>{t('pmu.description')}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
    </>
  )
}
