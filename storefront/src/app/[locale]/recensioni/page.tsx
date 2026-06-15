import { getAllPublishedReviews } from '@/lib/reviews-db'
import { getProducts, cmsImageUrl } from '@/lib/cms'
import { getLocale } from 'next-intl/server'
import Image from 'next/image'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

interface Props {
  searchParams: Promise<{ prodotto?: string; stelle?: string }>
}

function Stars({ rating }: { rating: number }) {
  return <span style={{ color: '#c8a97e' }}>{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ prodotto?: string; stelle?: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const { prodotto, stelle } = await searchParams
  const isFiltered = !!(prodotto || stelle)
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/recensioni`]))
  return {
    title: locale === 'it' ? 'Recensioni — The Foolish Butcher' : 'Reviews — The Foolish Butcher',
    description:
      locale === 'it'
        ? 'Recensioni verificate da acquirenti reali di pelle sintetica per tattoo e PMU.'
        : 'Verified reviews from real buyers of synthetic tattoo and PMU practice skin.',
    robots: isFiltered ? { index: false, follow: false } : { index: true, follow: true },
    alternates: isFiltered
      ? undefined
      : {
          canonical: `${BASE}/${locale}/recensioni`,
          languages: { ...langs, 'x-default': `${BASE}/it/recensioni` },
        },
  }
}

export default async function RecensioniPage({ searchParams }: Props) {
  const locale = await getLocale()
  const { prodotto, stelle } = await searchParams

  const [reviews, allProducts] = await Promise.all([
    getAllPublishedReviews({
      productSlug: prodotto,
      rating: stelle ? parseInt(stelle) : undefined,
      limit: 12,
    }),
    getProducts(undefined, locale),
  ])

  return (
    <main className="max-w-4xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
        {locale === 'it' ? 'Recensioni' : 'Reviews'}
      </h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-fg)' }}>
        {locale === 'it' ? 'Solo acquirenti verificati.' : 'Verified buyers only.'}
      </p>

      {/* Filtri */}
      <form method="GET" className="flex gap-3 flex-wrap mb-8">
        <select name="prodotto" defaultValue={prodotto ?? ''}
          className="rounded-xl border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          <option value="">{locale === 'it' ? 'Tutti i prodotti' : 'All products'}</option>
          {allProducts.map((p) => (
            <option key={p.slug} value={p.slug}>{p.name}</option>
          ))}
        </select>
        <select name="stelle" defaultValue={stelle ?? ''}
          className="rounded-xl border px-3 py-2 text-sm"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        >
          <option value="">{locale === 'it' ? 'Tutte le stelle' : 'All ratings'}</option>
          {[5,4,3,2,1].map((s) => <option key={s} value={s}>{s} ★</option>)}
        </select>
        <button type="submit" className="rounded-xl px-4 py-2 text-sm font-semibold"
          style={{ backgroundColor: '#c8a97e', color: '#000' }}>
          {locale === 'it' ? 'Filtra' : 'Filter'}
        </button>
      </form>

      {reviews.length === 0 ? (
        <p style={{ color: 'var(--muted-fg)' }}>
          {locale === 'it' ? 'Nessuna recensione trovata.' : 'No reviews found.'}
        </p>
      ) : (
        <div className="space-y-6">
          {reviews.map((r) => (
            <div key={r.id} className="rounded-2xl border p-6"
              style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2 mb-2">
                <Stars rating={r.rating} />
                <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {r.reviewer_name ?? 'Cliente verificato'}
                </span>
                <span className="text-xs" style={{ color: 'var(--muted-fg)' }}>
                  · {r.product_slug}
                </span>
                <span className="text-xs ml-auto" style={{ color: 'var(--muted-fg)' }}>
                  {r.published_at ? new Date(r.published_at).toLocaleDateString(locale) : ''}
                </span>
              </div>
              {r.body && (
                <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--foreground)' }}>
                  {r.body}
                </p>
              )}
              {r.photo_urls.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {r.photo_urls.map((url, i) => (
                    <div key={i} className="relative w-24 h-24 rounded-xl overflow-hidden"
                      style={{ backgroundColor: 'var(--muted)' }}>
                      <Image src={cmsImageUrl(url)} alt="" fill className="object-cover" sizes="96px" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
