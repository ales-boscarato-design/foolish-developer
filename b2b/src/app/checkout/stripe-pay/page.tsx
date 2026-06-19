'use client'
import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCart } from '@/lib/cart'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

function PayForm({ orderNumber }: { orderNumber: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { clear } = useCart()
  const t = useTranslations('StripePay')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setLoading(true)
    setError(null)

    try {
      const { error: stripeError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/checkout/conferma?ordine=${orderNumber}&metodo=stripe`,
        },
      })

      if (stripeError) {
        setError(stripeError.message ?? t('errore'))
      } else {
        // Stripe redirects on success — clear cart optimistically
        clear()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <PaymentElement />
      {error && <p style={{ color: '#f87171', fontSize: '0.875rem' }}>{error}</p>}
      <button
        type="submit"
        disabled={loading || !stripe || !elements}
        style={{
          background: loading || !stripe || !elements ? 'rgba(200,169,126,0.3)' : 'var(--accent)',
          color: '#080808',
          border: 'none',
          borderRadius: '0.625rem',
          padding: '0.875rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          cursor: loading || !stripe || !elements ? 'not-allowed' : 'pointer',
          width: '100%',
          letterSpacing: '0.04em',
          transition: 'background var(--dur-fast)',
        }}
      >
        {loading ? t('elaborazione') : t('pagaOra')}
      </button>
    </form>
  )
}

export default function StripePayPage() {
  const [stripeData, setStripeData] = useState<{
    clientSecret: string; orderNumber: string
  } | null>(null)
  const router = useRouter()
  const t = useTranslations('StripePay')
  const locale = useLocale()

  useEffect(() => {
    const data = sessionStorage.getItem('stripe_order')
    if (!data) { router.replace('/carrello'); return }
    try {
      const parsed = JSON.parse(data) as { clientSecret: string; orderNumber: string }
      sessionStorage.removeItem('stripe_order')
      setStripeData({ clientSecret: parsed.clientSecret, orderNumber: parsed.orderNumber })
    } catch {
      sessionStorage.removeItem('stripe_order')
      router.replace('/carrello')
    }
  }, [router])

  if (!stripeData) return <p style={{ color: 'var(--muted-fg)' }}>{t('caricamento')}</p>

  return (
    <div style={{ maxWidth: '28rem', margin: '0 auto', marginTop: '2.5rem' }}>
      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.75rem', color: 'var(--foreground)', marginBottom: '1.75rem' }}>
        {t('titolo')}
      </h1>
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret: stripeData.clientSecret,
          locale: locale as 'it' | 'fr' | 'en' | 'es',
          appearance: {
            theme: 'night',
            variables: {
              colorPrimary: '#c8a97e',
              colorBackground: '#111110',
              colorText: '#f0ede8',
              colorTextSecondary: '#9c9890',
              colorDanger: '#f87171',
              borderRadius: '8px',
              fontFamily: 'Outfit, sans-serif',
            },
          },
        }}
      >
        <PayForm orderNumber={stripeData.orderNumber} />
      </Elements>
    </div>
  )
}
