'use client'
import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { useCart } from '@/lib/cart'
import { useRouter } from 'next/navigation'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

function PayForm({ orderNumber }: { orderNumber: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { clear } = useCart()

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
        setError(stripeError.message ?? 'Errore pagamento')
      } else {
        // Stripe redirects on success — clear cart optimistically
        clear()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full bg-stone-900 text-white py-3 rounded text-sm hover:bg-stone-700 disabled:opacity-50"
      >
        {loading ? 'Elaborazione...' : 'Paga ora'}
      </button>
    </form>
  )
}

export default function StripePayPage() {
  const [stripeData, setStripeData] = useState<{
    clientSecret: string; orderNumber: string
  } | null>(null)
  const router = useRouter()

  useEffect(() => {
    const data = sessionStorage.getItem('stripe_order')
    if (!data) { router.replace('/carrello'); return }
    const parsed = JSON.parse(data) as { clientSecret: string; orderNumber: string }
    sessionStorage.removeItem('stripe_order')
    setStripeData({ clientSecret: parsed.clientSecret, orderNumber: parsed.orderNumber })
  }, [router])

  if (!stripeData) return <p className="text-stone-400">Caricamento...</p>

  return (
    <div className="max-w-md mx-auto mt-10">
      <h1 className="text-xl font-semibold mb-6">Pagamento con carta</h1>
      <Elements
        stripe={stripePromise}
        options={{ clientSecret: stripeData.clientSecret, locale: 'it' }}
      >
        <PayForm orderNumber={stripeData.orderNumber} />
      </Elements>
    </div>
  )
}
