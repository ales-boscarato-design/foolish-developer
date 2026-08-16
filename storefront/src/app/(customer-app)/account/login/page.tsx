'use client'
import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { getT, getClientLocale } from '@/lib/account-translations'
import type { AccountLocale } from '@/lib/account-translations'

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [locale] = useState<AccountLocale>(getClientLocale)
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  const t = getT(locale)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/account/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '360px', width: '100%' }}>
        <div style={{ fontSize: '11px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '24px' }}>
          The Foolish Butcher
        </div>

        {error && (
          <div style={{ background: '#3a1a1a', border: '1px solid #c9696944', color: '#c96969', fontSize: '12px', padding: '10px 12px', borderRadius: '6px', marginBottom: '16px' }}>
            {error === 'expired' ? t('login_error_expired') : t('login_error_missing')}
          </div>
        )}

        {sent ? (
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 300, color: '#fff', marginBottom: '12px' }}>{t('login_sent_title')}</h1>
            <p style={{ color: '#666', fontSize: '13px' }}>
              {t('login_sent_msg').split('$email')[0]}
              <strong style={{ color: '#aaa' }}>{email}</strong>
              {t('login_sent_msg').split('$email')[1]}
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={{ fontSize: '22px', fontWeight: 300, color: '#fff', marginBottom: '8px' }}>{t('login_title')}</h1>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>{t('login_subtitle')}</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login_placeholder')}
              required
              style={{
                width: '100%', padding: '12px', background: '#111', border: '1px solid #333',
                borderRadius: '6px', color: '#fff', fontSize: '14px', boxSizing: 'border-box',
                marginBottom: '12px', outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px', background: '#c9a96e', color: '#000',
                border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? t('login_sending') : t('login_button')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
