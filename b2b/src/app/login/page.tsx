'use client'
import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'

const inputStyle: React.CSSProperties = {
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  padding: '0.75rem 1rem',
  fontSize: '0.9rem',
  color: 'var(--foreground)',
  outline: 'none',
  width: '100%',
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  borderRadius: '0.75rem',
  padding: '0.75rem 1.5rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  width: '100%',
  letterSpacing: '0.02em',
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: 'rgba(192,57,43,0.1)',
      border: '1px solid rgba(192,57,43,0.3)',
      borderRadius: '0.5rem',
      padding: '0.75rem 1rem',
      marginBottom: '1.25rem',
      fontSize: '0.85rem',
      color: '#e57373',
    }}>
      {msg}
    </div>
  )
}

type UIStep = 'email' | 'login' | 'register'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email o password non corretti.',
  account_suspended: 'Account sospeso. Contatta il supporto.',
  password_too_short: 'La password deve essere di almeno 6 caratteri.',
  business_name_required: 'Inserisci il nome della tua attività.',
  default: 'Si è verificato un errore. Riprova.',
}

function LoginForm() {
  const router = useRouter()
  const [uiStep, setUiStep] = useState<UIStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'check', email }),
      })
      const data = await res.json()
      setUiStep(data.exists ? 'login' : 'register')
    } catch {
      setError(ERROR_MESSAGES.default)
    } finally {
      setLoading(false)
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, string> = { step: 'auth', email, password }
      if (uiStep === 'register') body.businessName = businessName
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        router.replace(data.isNew ? '/catalogo?_register=1' : '/catalogo?_login=1')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(ERROR_MESSAGES[data?.error] ?? ERROR_MESSAGES.default)
      }
    } catch {
      setError(ERROR_MESSAGES.default)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 600, fontStyle: 'italic', fontSize: '2rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>
            The Foolish Butcher
          </h1>
          <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--muted-fg)' }}>
            Portale Rivenditori
          </p>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '2rem' }}>

          {error && <ErrorBox msg={error} />}

          {uiStep === 'email' && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Accedi o registrati</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Inserisci la tua email per continuare.
              </p>
              <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="email"
                  required
                  placeholder="La tua email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ ...primaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Attendere…' : 'Continua'}
                </button>
              </form>
            </>
          )}

          {uiStep === 'login' && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Bentornato</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                {email} — <button onClick={() => { setUiStep('email'); setError(null) }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>Cambia</button>
              </p>
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ ...primaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Attendere…' : 'Accedi'}
                </button>
              </form>
            </>
          )}

          {uiStep === 'register' && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Crea il tuo accesso</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                {email} — <button onClick={() => { setUiStep('email'); setError(null) }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>Cambia</button>
              </p>
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="text"
                  required
                  placeholder="Nome della tua attività"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Scegli una password (min. 6 caratteri)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ ...primaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Attendere…' : 'Registrati e accedi'}
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
