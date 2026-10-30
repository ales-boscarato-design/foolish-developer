'use client'
import { useState } from 'react'
import {
  getT,
  type AccountLocale,
  type AccountTKey,
} from '@/lib/account-translations'

const REORDER_ERROR_KEYS: Record<string, AccountTKey> = {
  prezzo_cambiato: 'reorder_err_price_changed',
  righe_non_disponibili: 'reorder_err_unavailable',
  spedizione_da_quotare: 'reorder_err_quote',
  catalogo_non_disponibile: 'reorder_err_catalog',
  ordine_troppo_grande: 'reorder_err_too_many',
}

export function ReorderButton({
  orderId,
  label = 'Riordina',
  locale = 'it',
}: {
  orderId: string
  label?: string
  locale?: AccountLocale
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const t = getT(locale)

  function messageForCode(code: unknown): string {
    const key = typeof code === 'string' ? REORDER_ERROR_KEYS[code] : undefined
    return t(key ?? 'reorder_err_generic')
  }

  async function handleReorder() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/account/reorder/${orderId}`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.url) {
        window.location.href = data.url
        return
      }
      setError(messageForCode(data.error))
    } catch {
      setError(t('reorder_err_generic'))
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleReorder() }}
        disabled={loading}
        style={{ background: '#c9a96e', color: '#000', border: 'none', padding: '7px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
      >
        {loading ? '...' : label}
      </button>
      {error && (
        <span style={{ fontSize: '10px', lineHeight: 1.4, color: '#e07a7a', maxWidth: '260px' }}>
          {error}
        </span>
      )}
    </div>
  )
}
