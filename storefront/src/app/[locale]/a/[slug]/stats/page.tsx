import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  fetchAffiliateConversions,
  nextTierThresholdCents,
  normalizeAffiliateSlug,
  resolveAffiliateForReport,
  summarizeAffiliateStats,
  verifyAffiliateStatsToken,
} from '@/lib/affiliate-referral'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Statistiche affiliazione',
  robots: { index: false, follow: false, nocache: true },
}

type PageProps = {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const euro = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' })
const percent = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const dateOnly = new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })

function formatEuro(cents: number): string {
  return euro.format(cents / 100)
}

function formatRate(bps: number): string {
  return `${percent.format(bps / 100)}%`
}

function formatDate(value: string | null): string {
  return value === null ? '—' : dateOnly.format(new Date(value))
}

export default async function AffiliateStatsPage({ params, searchParams }: PageProps) {
  const { slug } = await params
  const query = await searchParams

  const normalizedSlug = normalizeAffiliateSlug(slug)
  const rawToken = Array.isArray(query.token) ? query.token[0] : query.token
  if (normalizedSlug === null || !verifyAffiliateStatsToken(normalizedSlug, rawToken)) {
    notFound()
  }

  // Reporting uses the reporting resolver: pausing or archiving an affiliate
  // stops the discount but must not erase the figures it already earned.
  const affiliate = await resolveAffiliateForReport(normalizedSlug)
  if (!affiliate) notFound()

  const conversions = await fetchAffiliateConversions(affiliate.id)
  if (conversions === null) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', fontFamily: 'inherit' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Dati temporaneamente non disponibili</h1>
        <p style={{ opacity: 0.75, lineHeight: 1.6 }}>
          Non riusciamo a leggere le tue vendite in questo momento. Riprova tra qualche minuto:
          se il problema resta, segnalalo e lo sistemiamo.
        </p>
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
    ['Vendite attribuite', String(stats.salesCount)],
    ['Fatturato eleggibile', formatEuro(stats.eligibleAmountCents)],
    ['Commissione maturata', formatEuro(stats.commissionAmountCents)],
    ['Aliquota attuale', formatRate(currentRateBps)],
    ['Ultima vendita', formatDate(stats.lastPaidAt)],
  ]
  if (stats.refundedCount > 0) {
    rows.push(['Ordini rimborsati', String(stats.refundedCount)])
  }

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '64px 24px', fontFamily: 'inherit' }}>
      <p style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 12, opacity: 0.6, marginBottom: 8 }}>
        The Foolish Butcher — affiliazione
      </p>
      <h1 style={{ fontSize: 26, marginBottom: 4 }}>{affiliate.slug}</h1>
      <p style={{ opacity: 0.7, marginBottom: 32 }}>
        Codice collegato: <strong>{affiliate.promoCode ?? '—'}</strong>
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
          Prossimo aumento di commissione a {formatEuro(nextThreshold)} di fatturato eleggibile:
          mancano {formatEuro(missingToNext)}.
        </p>
      )}

      <p style={{ marginTop: 40, fontSize: 12, opacity: 0.55, lineHeight: 1.6 }}>
        Pagina privata, aggiornata in tempo reale dal registro vendite. I numeri non includono
        gli ordini non ancora pagati.
      </p>
    </main>
  )
}
