'use client'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

function LoginForm() {
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  const errorMessages: Record<string, string> = {
    invalid: 'Link non valido.',
    expired: 'Link scaduto. Richiedi un nuovo accesso.',
    unauthorized: 'Account non autorizzato o sospeso.',
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <h1 className="text-2xl font-semibold mb-2">Area Rivenditori</h1>
      <p className="text-stone-500 mb-8 text-sm">
        Inserisci la tua email per ricevere il link di accesso.
      </p>

      {errorParam && (
        <p className="bg-red-50 text-red-700 text-sm px-4 py-2 rounded mb-4">
          {errorMessages[errorParam] ?? 'Errore sconosciuto.'}
        </p>
      )}

      {sent ? (
        <div className="bg-green-50 text-green-700 px-4 py-3 rounded text-sm">
          ✓ Se l&apos;email è registrata, riceverai il link entro pochi secondi.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            required
            placeholder="email@azienda.it"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="border border-stone-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stone-400"
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-stone-900 text-white rounded px-4 py-2 text-sm hover:bg-stone-700 disabled:opacity-50"
          >
            {loading ? 'Invio...' : 'Ricevi link di accesso'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="max-w-sm mx-auto mt-20 text-stone-400 text-sm">Caricamento...</div>}>
      <LoginForm />
    </Suspense>
  )
}
