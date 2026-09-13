import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import {
  fetchAffiliateConversions,
  nextTierThresholdCents,
  normalizeAffiliateSlug,
  resolveAffiliateForReport,
  summarizeAffiliateStats,
  verifyAffiliateStatsToken,
} from '@/lib/affiliate-referral'

export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Formatters follow the page language, not the shop's default one: a Spanish
 * affiliate reads "1.234,56 €" and a date in Spanish, exactly as the rest of the
 * site does in its own locale.
 */
function formattersFor(locale: string) {
  return {
    euro: new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }),
    percent: new Intl.NumberFormat(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
    date: new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long', year: 'numeric' }),
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'affiliateStats' })
  return {
    title: t('title'),
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function AffiliateStatsPage({ params, searchParams }: PageProps) {
  const { locale, slug } = await params
  const query = await searchParams

  const normalizedSlug = normalizeAffiliateSlug(slug)
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token
  if (normalizedSlug === null || !verifyAffiliateStatsToken(normalizedSlug, rawToken)) {
    notFound()
  }

  const t = await getTranslations({ locale, namespace: 'affiliateStats' })
  const format = formattersFor(locale)
  const formatEuro = (cents: number): string => format.euro.format(cents / 100)
  const formatRate = (bps: number): string => `${format.percent.format(bps / 100)}%`
  const formatDate = (value: string | null): string => (value === null ? '—' : format.date.format(new Date(value)))

  // Reporting uses the reporting resolver: pausing or archiving an affiliate
  // stops the discount but must not erase the figures it already earned.
  const affiliate = await resolveAffiliateForReport(normalizedSlug)
  if (!affiliate) notFound()

  const conversions = await fetchAffiliateConversions(affiliate.id)
  if (conversions === null) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', fontFamily: 'inherit' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>{t('errorTitle')}</h1>
        <p style={{ opacity: 0.75, lineHeight: 1.6 }}>{t('errorBody')}</p>
      </main>
    )
  }

  const stats = summarizeAffiliateStats(conversions)
  const nextThreshold = nextTierThresholdCents(affiliate, stats)
  const missingToNext = nextThreshold === null ? null : Math.max(nextThreshold - stats.eligibleAmountCents, 0)
  // Before the first eligible sale there is no ledger rate yet: show the
  // configured base rate instead of a misleading zero.
  const currentRateBps = stats.salesCount === 0 && affiliate.commissionBaseRateBps !== null
    ? affiliate.commissionBaseRateBps
    : stats.currentRateBps

  const rows: Array<[string, string]> = [
    [t('sales'), String(stats.salesCount)],
    [t('revenue'), formatEuro(stats.eligibleAmountCents)],
    [t('commission'), formatEuro(stats.commissionAmountCents)],
    [t('rate'), formatRate(currentRateBps)],
    [t('lastSale'), formatDate(stats.lastPaidAt)],
  ]
  if (stats.refundedCount > 0) {
    rows.push([t('refundedOrders'), String(stats.refundedCount)])
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', fontFamily: 'inherit' }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
        {t('eyebrow')}
      </p>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>{affiliate.slug}</h1>
      <p style={{ opacity: 0.7, marginBottom: 32 }}>
        {t('linkedCode')} <strong>{affiliate.promoCode ?? '—'}</strong>
      </p>

      <dl style={{ display: 'grid', gap: 12, margin: 0 }}>
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{ display: 'flex', justifyContent: 'space-between', gap: 16, borderBottom: '1px solid rgba(128,128,128,0.25)', paddingBottom: 10 }}
          >
            <dt style={{ opacity: 0.75 }}>{label}</dt>
            <dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd>
          </div>
        ))}
      </dl>

      {nextThreshold !== null && missingToNext !== null && (
        <p style={{ marginTop: 28, opacity: 0.75, lineHeight: 1.6 }}>
          {t('nextTier', {
            threshold: formatEuro(nextThreshold),
            missing: formatEuro(missingToNext),
          })}
        </p>
      )}

      <p style={{ marginTop: 40, fontSize: 12, opacity: 0.55, lineHeight: 1.6 }}>
        {t('footer')}
      </p>
    </main>
  )
}
