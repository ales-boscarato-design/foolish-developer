import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber } from '@/lib/account-db'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import { ProfileForm } from './_components/ProfileForm'

export default async function ProfiloPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const [subscriber, locale] = await Promise.all([
    getAccountSubscriber(session.email),
    getAccountLocale(),
  ])
  if (!subscriber) redirect('/account/login')

  const t = getT(locale)

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ width: '44px', height: '44px', background: '#1a1a1a', border: '1px solid #c9a96e44', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#c9a96e' }}>
          {subscriber.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 300 }}>{subscriber.name ?? t('customer')}</div>
          <div style={{ fontSize: '11px', color: '#555' }}>{subscriber.email}</div>
        </div>
      </div>

      <ProfileForm
        level={subscriber.level}
        styles={subscriber.styles ?? []}
        locale={subscriber.locale}
        notifyOrders={subscriber.notify_orders}
        notifyNewBatches={subscriber.notify_new_batches}
        notifyOffers={subscriber.notify_offers}
        pushPublicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''}
        labels={{
          whoAreYou: t('who_are_you'),
          preferredStyle: t('preferred_style'),
          commLanguage: t('comm_language'),
          notifications: t('notifications'),
          notifyOrdersLabel: t('notify_orders_label'),
          notifyOrdersSub: t('notify_orders_sub'),
          notifyBatchesLabel: t('notify_batches_label'),
          notifyBatchesSub: t('notify_batches_sub'),
          notifyOffersLabel: t('notify_offers_label'),
          notifyOffersSub: t('notify_offers_sub'),
          pushActive: t('push_active'),
          pushDenied: t('push_denied'),
          pushEnable: t('push_enable'),
          logout: t('logout'),
          savedLabel: t('saved_label'),
        }}
      />
    </div>
  )
}
