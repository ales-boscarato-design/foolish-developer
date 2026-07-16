'use client'
import { useState } from 'react'

export function SyncPrintfulButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function handleSync() {
    setStatus('loading')
    setMessage('')
    try {
      const res = await fetch('/api/products/sync-printful', { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Errore sconosciuto')
      setStatus('done')
      setMessage(`Sincronizzati ${data.synced} prodotti.`)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'Errore sconosciuto')
    }
  }

  return (
    <div style={{ padding: '12px 0' }}>
      <button
        onClick={handleSync}
        disabled={status === 'loading'}
        style={{
          padding: '8px 16px',
          borderRadius: '4px',
          border: '1px solid #333',
          background: status === 'loading' ? '#555' : '#000',
          color: '#fff',
          cursor: status === 'loading' ? 'default' : 'pointer',
        }}
      >
        {status === 'loading' ? 'Sincronizzazione...' : 'Sincronizza da Printful'}
      </button>
      {message && (
        <p style={{ marginTop: '8px', fontSize: '13px', color: status === 'error' ? '#c0392b' : '#2ecc71' }}>
          {message}
        </p>
      )}
    </div>
  )
}
