'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

type FormState = 'idle' | 'loading' | 'success' | 'error'

export default function ProPage() {
  const t = useTranslations('pro')
  const [state, setState] = useState<FormState>('idle')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    vatNumber: '',
    businessName: '',
    contactName: '',
    email: '',
    telegramUsername: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('loading')
    setError('')
    try {
      const res = await fetch('/api/pro/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vatNumber: form.vatNumber,
          businessName: form.businessName,
          contactName: form.contactName,
          email: form.email,
          telegramUsername: form.telegramUsername || undefined,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setCode(data.code)
        setState('success')
      } else {
        setError(t(`errors.${data.error}` as Parameters<typeof t>[0]) ?? t('errors.generic'))
        setState('error')
      }
    } catch {
      setError(t('errors.generic'))
      setState('error')
    }
  }

  if (state === 'success') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-6">✓</div>
        <h1 className="text-2xl font-bold mb-3">{t('successTitle')}</h1>
        <p className="mb-6" style={{ color: 'var(--muted-fg)' }}>{t('successBody')}</p>
        <div
          className="inline-block px-6 py-3 rounded font-mono text-xl font-bold mb-8 border"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
        >
          {code}
        </div>
        <p className="text-sm mb-8" style={{ color: 'var(--muted-fg)' }}>{t('successHint')}</p>
        <Link
          href={`/pro/card/${code}`}
          className="inline-block px-6 py-3 rounded font-semibold text-sm"
          style={{ backgroundColor: 'var(--accent)', color: 'black' }}
        >
          {t('viewCard')}
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="mb-12">
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--accent)' }}>
          {t('badge')}
        </span>
        <h1 className="text-3xl font-bold mt-2 mb-4">{t('title')}</h1>
        <p className="text-lg mb-8" style={{ color: 'var(--muted-fg)' }}>{t('subtitle')}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
          {(['benefit1', 'benefit2', 'benefit3'] as const).map((key) => (
            <div
              key={key}
              className="rounded-lg p-5 border"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
            >
              <p className="font-semibold text-sm mb-1">{t(`${key}.title`)}</p>
              <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>{t(`${key}.body`)}</p>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-lg border p-8"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
      >
        <h2 className="font-semibold text-lg mb-6">{t('formTitle')}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {(['vatNumber', 'businessName', 'contactName', 'email'] as const).map((field) => (
            <div key={field}>
              <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted-fg)' }}>
                {t(`fields.${field}`)}
              </label>
              <input
                type={field === 'email' ? 'email' : 'text'}
                required
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full px-3 py-2 rounded border text-sm"
                style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
              />
            </div>
          ))}
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1.5" style={{ color: 'var(--muted-fg)' }}>
              {t('fields.telegramUsername')} <span>({t('optional')})</span>
            </label>
            <input
              type="text"
              value={form.telegramUsername}
              onChange={(e) => setForm((f) => ({ ...f, telegramUsername: e.target.value }))}
              placeholder="@username"
              className="w-full px-3 py-2 rounded border text-sm"
              style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
            />
          </div>

          {state === 'error' && (
            <p className="text-sm" style={{ color: '#f44336' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={state === 'loading'}
            className="w-full py-3 rounded font-semibold text-sm transition-opacity disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent)', color: 'black' }}
          >
            {state === 'loading' ? t('submitting') : t('submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
