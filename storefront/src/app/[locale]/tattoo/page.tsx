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
  const t = await getTranslations('sections.tattoo')
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/tattoo`]))
  return {
    title: t('meta'),
    description:
      locale === 'it'
        ? 'Pelle sintetica artigianale per la pratica del tattoo. Fogli A5, A4, XXL e pelli 3D. Produzione italiana.'
        : 'Handcrafted synthetic practice skin for tattooing. A5, A4, XXL sheets and 3D skins. Made in Italy.',
    alternates: {
      canonical: `${BASE}/${locale}/tattoo`,
      languages: { ...langs, 'x-default': `${BASE}/it/tattoo` },
    },
    openGraph: {
      url: `${BASE}/${locale}/tattoo`,
      images: [{ url: '/og/home.jpg', width: 1200, height: 630, alt: 'Tattoo Practice Skin — The Foolish Butcher' }],
    },
  }
}

export default async function TattooPage() {
  const t = await getTranslations('sections')
  const locale = await getLocale()
  const products = await getProducts('tattoo', locale)
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${BASE}/${locale}` },
      { '@type': 'ListItem', position: 2, name: 'Tattoo Practice Skin', item: `${BASE}/${locale}/tattoo` },
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
        <h1 className="text-3xl font-bold">{t('tattoo.title')}</h1>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-fg)' }}>{t('tattoo.description')}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
    </div>
    </>
  )
}
