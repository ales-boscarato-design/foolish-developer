import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import { getBenefitForCycle, getNextTierCyclesRemaining, type PlanKey, type Zone } from '@/lib/subscription-plans'
import { CancelSubscriptionButton } from './_components/CancelSubscriptionButton'

const PLAN_LABELS: Record<PlanKey, string> = { tattoo: 'Tattoo XXL', pmu: 'PMU 3 Visi' }
const ZONE_LABELS: Record<Zone, string> = { IT: 'Italia', EU: 'Europa' }

interface SubscriptionDoc {
  id: string
  plan: PlanKey
  zone: Zone
  status: 'active' | 'canceling' | 'canceled'
  cyclesCompleted: number
}

export default async function AbbonamentoPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const locale = await getAccountLocale()
  const t = getT(locale)

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/subscriptions?where[customerEmail][equals]=${encodeURIComponent(session.email)}&where[status][not_equals]=canceled&sort=-createdAt&limit=10&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' },
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const subscriptions: SubscriptionDoc[] = data.docs ?? []

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
          {t('subscription_title')}
        </div>
      </div>

      {subscriptions.length === 0 && (
        <p style={{ fontSize: '12px', color: '#777' }}>{t('subscription_none')}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {subscriptions.map((sub) => {
          const currentCycle = Math.max(1, sub.cyclesCompleted)
          const benefit = getBenefitForCycle(sub.plan, sub.zone, currentCycle)
          const cyclesRemaining = getNextTierCyclesRemaining(sub.cyclesCompleted)

          return (
            <div key={sub.id} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '14px' }}>
              <div style={{ fontSize: '13px', color: '#fff', marginBottom: '4px' }}>
                {PLAN_LABELS[sub.plan]} · {ZONE_LABELS[sub.zone]}
              </div>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
                {t('subscription_cycle')} {currentCycle} · {t('subscription_current_price')} €{benefit.total.toFixed(2)}
              </div>
              <div style={{ fontSize: '11px', color: '#c9a96e', marginBottom: '10px' }}>
                {cyclesRemaining > 0
                  ? t('subscription_next_tier').replace('{n}', String(cyclesRemaining))
                  : t('subscription_maxed')}
              </div>
              {sub.status === 'canceling' ? (
                <span style={{ fontSize: '11px', color: '#c07a7a' }}>{t('subscription_canceling')}</span>
              ) : (
                <CancelSubscriptionButton
                  subscriptionDocId={sub.id}
                  label={t('subscription_cancel')}
                  confirmLabel={t('subscription_cancel')}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
