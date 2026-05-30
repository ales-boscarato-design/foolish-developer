import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Package, ArrowRight, CheckCircle } from 'lucide-react'
import { Suspense } from 'react'

interface GraziePageProps {
  searchParams: Promise<{ session_id?: string }>
}

async function OrderVerifier({ sessionId }: { sessionId: string }) {
  const t = await getTranslations('grazie')

  let orderRef: string | null = null
  let total = 0
  let customerName = ''
  let items: { name: string; quantity: number; unitAmount: number }[] = []
  let verified = false

  try {
    const res = await fetch(
      `${process.env.STOREFRONT_URL || 'http://localhost:3000'}/api/stripe/session?session_id=${encodeURIComponent(sessionId)}`,
      { cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      if (data.paymentStatus === 'paid') {
        orderRef = data.orderRef
        total = data.total ?? 0
        customerName = data.customerName ?? ''
        items = data.items ?? []
        verified = true
      }
    }
  } catch {
    // Stripe verify failed — still show generic success
  }

  if (!verified) {
    return (
      <div className="rounded-lg p-4 mb-8 border text-sm" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
        <p style={{ color: 'var(--muted-fg)' }}>{t('subtitle')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-lg p-5 mb-6 border text-left" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}>
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle size={16} style={{ color: '#4caf50' }} />
          <span className="text-sm font-medium" style={{ color: '#4caf50' }}>Pagamento verificato</span>
        </div>
        {orderRef && (
          <div className="text-xs mb-2" style={{ color: 'var(--muted-fg)' }}>
            Ordine: <span className="font-mono">{orderRef}</span>
          </div>
        )}
        {customerName && (
          <p className="text-sm mb-2">Ciao {customerName.split(' ')[0]},</p>
        )}
        <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>
          Totale pagato: <span className="font-semibold" style={{ color: 'var(--foreground)' }}>{total.toFixed(2)}€</span>
        </p>
        {items.length > 0 && (
          <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            {items.slice(0, 3).map((item, i) => (
              <div key={i} className="flex justify-between text-xs py-0.5">
                <span style={{ color: 'var(--muted-fg)' }}>{item.name} × {item.quantity}</span>
                <span>{(item.unitAmount * item.quantity).toFixed(2)}€</span>
              </div>
            ))}
            {items.length > 3 && (
              <p className="text-xs pt-1" style={{ color: 'var(--muted-fg)' }}>+ altri {items.length - 3} prodotti</p>
            )}
          </div>
        )}
      </div>

      {orderRef && (
        <div className="mb-6">
          <Link
            href={`/account/ordine/${encodeURIComponent(orderRef)}`}
            className="inline-flex items-center gap-2 px-6 py-3 rounded font-semibold text-sm transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--accent)', color: 'black' }}
          >
            <Package size={15} />
            I tuoi ordini
            <ArrowRight size={14} />
          </Link>
        </div>
      )}
    </>
  )
}

export async function generateMetadata() {
  const t = await getTranslations('grazie')
  return { title: `${t('title')} — The Foolish Butcher` }
}

export default async function GraziePage({ searchParams }: GraziePageProps) {
  const t = await getTranslations('grazie')
  const { session_id } = await searchParams

  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <div className="text-5xl mb-6">✓</div>
      <h1 className="text-2xl font-bold mb-3">{t('title')}</h1>
      <p className="mb-4" style={{ color: 'var(--muted-fg)' }}>
        {t('subtitleLine2')}
      </p>

      {session_id && (
        <Suspense fallback={
          <div className="rounded-lg p-4 mb-6 border animate-pulse" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }} />
        }>
          <OrderVerifier sessionId={session_id} />
        </Suspense>
      )}

      <div className="rounded-lg p-5 mb-8 border text-left" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
        <p className="font-medium mb-2">{t('telegramTitle')}</p>
        <p className="text-sm mb-4" style={{ color: 'var(--muted-fg)' }}>{t('telegramBody')}</p>
        <a
          href={`https://t.me/the_foolish_butcher_bot${session_id ? `?start=session_${session_id}` : ''}`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded font-semibold text-sm"
          style={{ backgroundColor: '#229ED9', color: 'white' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.614c-.146.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.903.607z"/>
          </svg>
          {t('telegramCta')}
        </a>
      </div>

      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--muted-fg)' }}>
        {t('backToShop')}
      </Link>
    </div>
  )
}
