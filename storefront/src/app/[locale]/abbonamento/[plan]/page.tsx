export const dynamic = 'force-dynamic'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSubscriptionPlanConfig } from '@/lib/cms'
import { SubscriptionRoadmap } from '@/components/SubscriptionRoadmap'
import { SubscriptionGallery } from '@/components/SubscriptionGallery'
import { RichText } from '@/components/RichText'
import { SubscribeCTA } from './_components/SubscribeCTA'
import type { PlanKey } from '@/lib/subscription-plans'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
const VALID_PLANS = ['tattoo', 'pmu'] as const

interface Props {
  params: Promise<{ plan: string; locale: string }>
}

function isValidPlan(plan: string): plan is PlanKey {
  return (VALID_PLANS as readonly string[]).includes(plan)
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { plan, locale } = await params
  if (!isValidPlan(plan)) return {}
  const config = await getSubscriptionPlanConfig(plan, locale)
  const langs = Object.fromEntries(LOCALES.map((l) => [l, `${BASE}/${l}/abbonamento/${plan}`]))
  return {
    title: config?.product.name ?? plan,
    description: config?.product.shortDescription,
    alternates: { canonical: `${BASE}/${locale}/abbonamento/${plan}`, languages: { ...langs, 'x-default': `${BASE}/it/abbonamento/${plan}` } },
  }
}

export default async function AbbonamentoProductPage({ params }: Props) {
  const { plan, locale } = await params
  if (!isValidPlan(plan)) notFound()

  const config = await getSubscriptionPlanConfig(plan, locale)
  if (!config) notFound()

  const t = await getTranslations('subscription.product')
  const product = config.product

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">
      <div className="grid md:grid-cols-2 gap-10 mb-16">
        <SubscriptionGallery images={product.images} alt={product.name} />
        <div>
          <h1 className="font-display text-4xl mb-4">{product.name}</h1>
          <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>{product.shortDescription}</p>
          <RichText content={product.description} />
          <SubscribeCTA
            plan={plan}
            locale={locale}
            ctaLabel={t('subscribeCta')}
            loadingLabel={t('loading')}
            zonePickerLabel={t('zonePickerLabel')}
            tabIt={t('tabIt')}
            tabEu={t('tabEu')}
          />
        </div>
      </div>

      <SubscriptionRoadmap
        plan={plan}
        labels={{
          tabIt: t('tabIt'),
          tabEu: t('tabEu'),
          cycle1: t('cycle1'),
          cycle2: t('cycle2'),
          cycle6: t('cycle6'),
          shippingIncluded: t('shippingIncluded'),
          giftIncluded: t('giftIncluded'),
          perMonth: t('perMonth'),
        }}
      />

      <div style={{ marginTop: '64px', maxWidth: '640px' }}>
        <h2 className="font-artisan text-2xl mb-6">{t('faqTitle')}</h2>
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <div key={n} style={{ padding: '20px 0', borderBottom: n < 6 ? '1px solid var(--border)' : 'none' }}>
            <p style={{ color: 'var(--foreground)', fontWeight: 600, marginBottom: '6px' }}>{t(`faqQ${n}`)}</p>
            <p style={{ color: 'var(--muted-fg)', fontSize: '14px' }}>{t(`faqA${n}`)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
