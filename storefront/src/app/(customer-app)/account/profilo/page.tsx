import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountSubscriber } from '@/lib/account-db'
import { ProfileForm } from './_components/ProfileForm'

export default async function ProfiloPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const subscriber = await getAccountSubscriber(session.email)
  if (!subscriber) redirect('/account/login')

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ width: '44px', height: '44px', background: '#1a1a1a', border: '1px solid #c9a96e44', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', color: '#c9a96e' }}>
          {subscriber.name?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 300 }}>{subscriber.name ?? 'Cliente'}</div>
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
      />
    </div>
  )
}
