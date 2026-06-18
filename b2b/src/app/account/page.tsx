'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatPrice } from '@/lib/pricing'

interface Order {
  id: number
  order_number: string
  total: number
  pipeline_state: string
  created_at: string
  tracking_number: string | null
}

const stateLabels: Record<string, string> = {
  received: 'Ricevuto',
  in_production: 'In produzione',
  shipped: 'Spedito',
  delivered: 'Consegnato',
}

interface SessionData {
  businessName: string
  contactName: string
  email: string
  vatNumber: string
}

export default function AccountPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [session, setSession] = useState<SessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetch('/api/account/orders')
      .then(r => {
        if (r.status === 401) { router.replace('/login'); return null }
        return r.ok ? r.json() : null
      })
      .then(data => {
        if (data) {
          setSession(data.session)
          setOrders(data.orders)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [router])

  if (loading) return <p className="text-stone-400">Caricamento...</p>

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-8">Il mio account</h1>

      {/* Profile */}
      {session && (
        <section className="mb-10">
          <h2 className="font-medium mb-3 pb-2 border-b border-stone-100">Profilo aziendale</h2>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-stone-500">Ragione sociale</dt>
            <dd>{session.businessName}</dd>
            <dt className="text-stone-500">Referente</dt>
            <dd>{session.contactName}</dd>
            <dt className="text-stone-500">Email</dt>
            <dd>{session.email}</dd>
            <dt className="text-stone-500">P.IVA</dt>
            <dd>{session.vatNumber}</dd>
          </dl>
        </section>
      )}

      {/* Orders */}
      <section>
        <h2 className="font-medium mb-3 pb-2 border-b border-stone-100">Storico ordini</h2>
        {orders.length === 0 ? (
          <p className="text-stone-400 text-sm">Nessun ordine ancora.</p>
        ) : (
          <div className="space-y-3">
            {orders.map(order => (
              <div key={order.id} className="border border-stone-200 rounded-lg p-4 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{order.order_number}</span>
                  <span className="text-xs bg-stone-100 text-stone-600 px-2 py-0.5 rounded">
                    {stateLabels[order.pipeline_state] ?? order.pipeline_state}
                  </span>
                </div>
                <div className="flex items-center justify-between text-stone-500">
                  <span>{new Date(order.created_at).toLocaleDateString('it-IT')}</span>
                  <span className="font-medium text-stone-900">{formatPrice(order.total)}</span>
                </div>
                {order.tracking_number && (
                  <p className="mt-1 text-xs text-stone-400">
                    Tracking: <span className="font-mono">{order.tracking_number}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
