import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import Link from 'next/link'
import { ReorderButton } from '../_components/ReorderButton'

const STATE_LABELS: Record<string, string> = {
  received: 'Ricevuto', eta_pending: 'In attesa ETA', eta_confirmed: 'Confermato',
  in_production: 'In produzione', matching_pending: 'Abbinamento', matched: 'Abbinato',
  preview_sent: 'Preview inviata', shipped: 'Spedito', delivered: 'Consegnato',
  followup_done: 'Completato', closed: 'Chiuso',
}

const ACTIVE_STATES = ['received','eta_pending','eta_confirmed','in_production','matching_pending','matched','preview_sent','shipped']

export default async function OrdiniPage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const res = await fetch(
    `${cmsUrl}/api/orders?where[customerEmail][equals]=${encodeURIComponent(session.email)}&sort=-createdAt&limit=50&depth=0`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const data = res.ok ? await res.json() : { docs: [] }
  const orders = data.docs ?? []

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>I tuoi ordini</div>
        <div style={{ fontSize: '18px', fontWeight: 300 }}>{orders.length} ordini totali</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {orders.map((order: Record<string, unknown>) => {
          const isActive = ACTIVE_STATES.includes(order.pipelineState as string)
          return (
            <div key={order.id as string} style={{ background: '#111', border: `1px solid ${isActive ? '#c9a96e44' : '#1e1e1e'}`, borderRadius: '8px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                <div style={{ fontSize: '13px' }}>#{order.orderNumber as string}</div>
                <div style={{ background: isActive ? '#c9a96e22' : '#5a7a5a22', color: isActive ? '#c9a96e' : '#5a7a5a', fontSize: '10px', padding: '2px 7px', borderRadius: '10px' }}>
                  {STATE_LABELS[order.pipelineState as string] ?? order.pipelineState as string}
                </div>
              </div>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
                €{(order.total as number)?.toFixed(2)}
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {!isActive && <ReorderButton orderId={order.orderNumber as string} />}
                <Link href={`/account/ordini/${order.orderNumber}`} style={{ background: '#1a1a1a', color: '#aaa', fontSize: '10px', padding: '4px 8px', borderRadius: '3px', border: '1px solid #333', textDecoration: 'none' }}>
                  Dettaglio →
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
