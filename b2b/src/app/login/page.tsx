'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const errorMessages: Record<string, string> = {
  invalid: 'Link non valido.',
  expired: 'Link scaduto. Richiedi un nuovo accesso.',
  unauthorized: 'Account non autorizzato o sospeso.',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 600, fontStyle: 'italic', fontSize: '2rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>
            The Foolish Butcher
          </h1>
          <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--muted-fg)' }}>
            Portale Rivenditori
          </p>
        </div>

        {/* Card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '2rem' }}>
          {errorKey && (
            <div style={{ background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: '#e57373' }}>
              {errorMessages[errorKey] ?? 'Errore sconosciuto.'}
            </div>
          )}

          {sent ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✓</div>
              <p style={{ color: 'var(--accent)', fontWeight: 500, marginBottom: '0.5rem' }}>Email inviata</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.5 }}>
                Se l&apos;email è registrata, riceverai il link di accesso entro pochi secondi.
              </p>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Accedi</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Inserisci la tua email. Ti invieremo un link di accesso sicuro.
              </p>
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="email"
                  required
                  placeholder="email@azienda.it"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: '0.75rem',
                    padding: '0.75rem 1rem',
                    fontSize: '0.9rem',
                    color: 'var(--foreground)',
                    outline: 'none',
                    width: '100%',
                  }}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    background: 'var(--accent)',
                    color: '#000',
                    border: 'none',
                    borderRadius: '0.75rem',
                    padding: '0.75rem 1.5rem',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                    transition: `opacity var(--dur-fast)`,
                    width: '100%',
                    letterSpacing: '0.02em',
                  }}
                >
                  {loading ? 'Invio in corso…' : 'Ricevi link di accesso'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--muted-fg)', opacity: 0.6 }}>
          Accesso riservato ai rivenditori autorizzati
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
