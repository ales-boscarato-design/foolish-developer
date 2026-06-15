import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'privacy' })
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/privacy`]))
  return {
    title: t('meta'),
    alternates: {
      canonical: `${BASE}/${locale}/privacy`,
      languages: { ...langs, 'x-default': `${BASE}/it/privacy` },
    },
  }
}

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-8 text-sm leading-relaxed text-[var(--muted-fg)]">
      <h1 className="font-bebas text-4xl tracking-wide text-[var(--fg)]">{t('title')}</h1>
      <p className="text-xs text-[var(--muted-fg)]">{t('lastUpdated')}</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('dataController')}</h2>
        <p>
          The Foolish Butcher · Chieri (TO), Italia · P.IVA IT12475480013<br />
          <a href="mailto:support.foolish@agentmail.to" className="underline">support.foolish@agentmail.to</a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('collectedData')}</h2>
        <p>{t('collectedDataIntro')}</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('dataItems.name')}</li>
          <li>{t('dataItems.email')}</li>
          <li>{t('dataItems.shipping')}</li>
          <li>{t('dataItems.telegramId')}</li>
        </ul>
        <p>{t('paymentData')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('purposes')}</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>{t('purposesList.orderManagement')}</li>
          <li>{t('purposesList.shippingUpdates')}</li>
          <li>{t('purposesList.afterSales')}</li>
          <li>{t('purposesList.taxCompliance')}</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('legalBasis')}</h2>
        <p>{t('legalBasisText')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('retention')}</h2>
        <p>{t('retentionText')}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('dataSubjectRights')}</h2>
        <p>{t('dataSubjectRightsText', { email: 'support.foolish@agentmail.to' })}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">{t('cookies')}</h2>
        <p>{t('cookiesText')}</p>
      </section>
    </div>
  )
}
