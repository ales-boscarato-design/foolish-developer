'use client'
import { useLocale } from 'next-intl'

const LOCALES = [
  { code: 'it', label: 'IT' },
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
]

export function LocaleSwitcher() {
  const locale = useLocale()

  function switchLocale(code: string) {
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000; SameSite=Lax`
    window.location.reload()
  }

  return (
    <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', marginLeft: '0.5rem', borderLeft: '1px solid var(--border)', paddingLeft: '0.75rem' }}>
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => switchLocale(code)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '0.25rem 0.375rem',
            fontSize: '0.7rem',
            fontWeight: code === locale ? 600 : 400,
            color: code === locale ? 'var(--accent)' : 'var(--muted-fg)',
            cursor: code === locale ? 'default' : 'pointer',
            letterSpacing: '0.08em',
            borderRadius: '0.25rem',
            opacity: code === locale ? 1 : 0.6,
            transition: 'color var(--dur-fast), opacity var(--dur-fast)',
          }}
          disabled={code === locale}
          aria-label={`Switch to ${label}`}
          aria-current={code === locale ? 'true' : undefined}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
