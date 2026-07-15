export const dynamic = 'force-dynamic'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations('subscription.hub')
  const langs = Object.fromEntries(LOCALES.map((l) => [l, `${BASE}/${l}/abbonamento`]))
  return {
    title: t('meta'),
    alternates: { canonical: `${BASE}/${locale}/abbonamento`, languages: { ...langs, 'x-default': `${BASE}/it/abbonamento` } },
  }
}

export default async function AbbonamentoHubPage() {
  const t = await getTranslations('subscription.hub')
  const locale = await getLocale()

  const cards = [
    { plan: 'tattoo', title: t('cardTattooTitle'), desc: t('cardTattooDesc') },
    { plan: 'pmu', title: t('cardPmuTitle'), desc: t('cardPmuDesc') },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'var(--accent)' }}>{t('meta')}</p>
      <h1 className="font-display text-4xl md:text-5xl mb-4">{t('title')}</h1>
      <p className="max-w-xl mb-12" style={{ color: 'var(--muted-fg)' }}>{t('subtitle')}</p>

      <div className="grid md:grid-cols-2 gap-6">
        {cards.map((c) => (
          <Link
            key={c.plan}
            href={`/${locale}/abbonamento/${c.plan}`}
            className="block p-8 rounded"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <h2 className="font-artisan text-2xl mb-3">{c.title}</h2>
            <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>{c.desc}</p>
            <span className="ghost-cta text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
              {t('cta')} →
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
