import Image from 'next/image'
import { cmsImageUrl } from '@/lib/cms'
import type { Review } from '@/lib/reviews-db'

function Stars({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <span style={{ color: '#c8a97e', fontSize: size }}>
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  )
}

interface Props {
  reviews: Review[]
  summary: { average: number; count: number }
  productSlug: string
  locale: string
}

export function ReviewList({ reviews, summary, productSlug, locale }: Props) {
  if (summary.count === 0) return null

  const moreUrl = `/${locale}/recensioni?prodotto=${productSlug}`

  return (
    <section className="mt-12 pt-8 border-t" style={{ borderColor: 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--foreground)' }}>
            {locale === 'it' ? 'Recensioni' : 'Reviews'}
          </h2>
          <div className="flex items-center gap-2">
            <Stars rating={Math.round(summary.average)} size={16} />
            <span className="text-sm" style={{ color: 'var(--muted-fg)' }}>
              {summary.average.toFixed(1)} · {summary.count} {locale === 'it' ? 'recensioni' : 'reviews'}
            </span>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-6">
        {reviews.map((r) => (
          <div key={r.id} className="border-b pb-6 last:border-0" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Stars rating={r.rating} />
              <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                {r.reviewer_name ?? 'Cliente verificato'}
              </span>
              <span className="text-xs" style={{ color: 'var(--muted-fg)' }}>
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
                  <div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--muted)' }}>
                    <Image src={cmsImageUrl(url)} alt="" fill className="object-cover" sizes="80px" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Link a tutte */}
      {summary.count > 5 && (
        <a
          href={moreUrl}
          className="block text-center text-sm mt-6 underline"
          style={{ color: 'var(--accent)' }}
        >
          {locale === 'it' ? `Mostra tutte le ${summary.count} recensioni` : `Show all ${summary.count} reviews`}
        </a>
      )}
    </section>
  )
}
