import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'termini' })
  return {
    title: t('meta'),
  }
}

export default async function TerminiPage() {
  const t = await getTranslations('termini')

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
          <li>{t('shippingRates.italy')}</li>
          <li>{t('shippingRates.europe')}</li>
          <li>{t('shippingRates.world')}</li>
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
