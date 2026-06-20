'use client'
import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

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

function LoginForm() {
  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const router = useRouter()
  const t = useTranslations('Login')

  // Magic link state
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [magicLoading, setMagicLoading] = useState(false)
  const [magicError, setMagicError] = useState(false)

  // Classic login state
  const [classicName, setClassicName] = useState('')
  const [classicEmail, setClassicEmail] = useState('')
  const [classicPhone, setClassicPhone] = useState('')
  const [classicLoading, setClassicLoading] = useState(false)
  const [classicError, setClassicError] = useState<string | null>(null)

  async function handleMagicSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMagicLoading(true)
    setMagicError(false)
    try {
      await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: magicEmail }),
      })
      setMagicSent(true)
    } catch {
      setMagicError(true)
    } finally {
      setMagicLoading(false)
    }
  }

  async function handleClassicSubmit(e: React.FormEvent) {
    e.preventDefault()
    setClassicLoading(true)
    setClassicError(null)
    try {
      const res = await fetch('/api/auth/classic-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: classicEmail,
          businessName: classicName,
          phone: classicPhone,
        }),
      })
      if (res.ok) {
        router.replace('/catalogo?_login=1')
      } else {
        const data = await res.json().catch(() => ({}))
        const key = data?.error as string | undefined
        const msg = key
          ? (t.raw(`classicErrors.${key}`) as string | undefined ?? t('classicErrors.unknown'))
          : t('classicErrors.unknown')
        setClassicError(msg)
      }
    } catch {
      setClassicError(t('classicErrors.unknown'))
    } finally {
      setClassicLoading(false)
    }
  }

  const urlError = errorKey
    ? (t.raw(`errors.${errorKey}`) as string | undefined ?? t('errors.unknown'))
    : null

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 600, fontStyle: 'italic', fontSize: '2rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>
            The Foolish Butcher
          </h1>
          <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--muted-fg)' }}>
            {t('portaleRivenditori')}
          </p>
        </div>

        {/* URL error (invalid/expired token) */}
        {urlError && <ErrorBox msg={urlError} />}

        {/* ── Magic link ── */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '2rem', marginBottom: '1rem' }}>
          {magicSent ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>✓</div>
              <p style={{ color: 'var(--accent)', fontWeight: 500, marginBottom: '0.5rem' }}>{t('emailInviata')}</p>
              <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.5 }}>{t('emailInviataDesc')}</p>
            </div>
          ) : (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>{t('accedi')}</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>{t('desc')}</p>
              {magicError && <ErrorBox msg={t('errors.unknown')} />}
              <form onSubmit={handleMagicSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="email"
                  required
                  placeholder={t('placeholder')}
                  value={magicEmail}
                  onChange={e => setMagicEmail(e.target.value)}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={magicLoading}
                  style={{ ...primaryBtn, cursor: magicLoading ? 'not-allowed' : 'pointer', opacity: magicLoading ? 0.6 : 1, transition: 'opacity var(--dur-fast)' }}
                >
                  {magicLoading ? t('invioInCorso') : t('riceviLink')}
                </button>
              </form>
            </>
          )}
        </div>

        {/* ── Divider ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: '1.25rem 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
          <span style={{ fontSize: '0.72rem', color: 'var(--muted-fg)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {t('oppure')}
          </span>
          <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
        </div>

        {/* ── Classic login ── */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '2rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>{t('classicTitle')}</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>{t('classicDesc')}</p>
          {classicError && <ErrorBox msg={classicError} />}
          <form onSubmit={handleClassicSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <input
              type="text"
              required
              placeholder={t('nomeAttivita')}
              value={classicName}
              onChange={e => setClassicName(e.target.value)}
              style={inputStyle}
            />
            <input
              type="email"
              required
              placeholder={t('placeholder')}
              value={classicEmail}
              onChange={e => setClassicEmail(e.target.value)}
              style={inputStyle}
            />
            <input
              type="tel"
              required
              placeholder={t('telefono')}
              value={classicPhone}
              onChange={e => setClassicPhone(e.target.value)}
              style={inputStyle}
            />
            <button
              type="submit"
              disabled={classicLoading}
              style={{ ...primaryBtn, cursor: classicLoading ? 'not-allowed' : 'pointer', opacity: classicLoading ? 0.6 : 1, transition: 'opacity var(--dur-fast)' }}
            >
              {classicLoading ? t('invioInCorso') : t('entra')}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--muted-fg)', opacity: 0.6 }}>
          {t('accessoRiservato')}
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
