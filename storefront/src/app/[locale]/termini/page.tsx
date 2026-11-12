import type { Metadata } from 'next'
import { getTranslations, getLocale } from 'next-intl/server'
import {
  flatShippingCostEuros,
  formatBadgeAmount,
  freeShippingThresholdEuros,
} from '@/lib/free-shipping-badge'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'termini' })
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/termini`]))
  return {
    title: t('meta'),
    alternates: {
      canonical: `${BASE}/${locale}/termini`,
      languages: { ...langs, 'x-default': `${BASE}/it/termini` },
    },
  }
}

export default async function TerminiPage() {
  const t = await getTranslations('termini')
  const locale = await getLocale()

  // Le tariffe e le soglie della pagina termini si leggono da `shipping.ts`,
  // non si scrivono a mano nel testo: la riga italiana diceva «gratuita sopra
  // 50€» mentre il codice applicava un'altra soglia.
  const shippingRates = {
    italy: {
      cost: formatBadgeAmount(locale, flatShippingCostEuros('IT'), 2),
      amount: formatBadgeAmount(locale, freeShippingThresholdEuros('IT')),
    },
    europe: {
      cost: formatBadgeAmount(locale, flatShippingCostEuros('EU'), 2),
      amount: formatBadgeAmount(locale, freeShippingThresholdEuros('EU')),
    },
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-8 text-sm leading-relaxed text-[var(--muted-fg)]">
      <h1 className="font-bebas text-4xl tracking-wide text-[var(--fg)]">{t('title')}</h1>
      <p className="text-xs text-[var(--muted-fg)]">{t('lastUpdated')}</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('seller')}</h2>
        <p>
          The Foolish Butcher, con sede in Chieri (TO), Italia · P.IVA IT12475480013 ·{' '}
          <a href="mailto:support.foolish@agentmail.to" className="underline">support.foolish@agentmail.to</a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('products')}</h2>
        <p>{t('productsText')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('pricing')}</h2>
        <p>{t('pricingText')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('shipping')}</h2>
        <p>{t('shippingText')}</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('shippingRates.italy', shippingRates.italy)}</li>
          <li>{t('shippingRates.europe', shippingRates.europe)}</li>
          <li>{t('shippingRates.extraEu')}</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('withdrawal')}</h2>
        <p>{t('withdrawalText1', { email: 'support.foolish@agentmail.to' })}</p>
        <p>{t('withdrawalText2')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('warranty')}</h2>
        <p>{t('warrantyText', { email: 'support.foolish@agentmail.to' })}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('liability')}</h2>
        <p>{t('liabilityText')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('jurisdiction')}</h2>
        <p>{t('jurisdictionText')}</p>
      </section>
    </div>
  )
}
