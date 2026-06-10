'use client'
import { useState } from 'react'

export function ReorderButton({ orderId, label = 'Riordina' }: { orderId: string; label?: string }) {
  const [loading, setLoading] = useState(false)

  async function handleReorder() {
    setLoading(true)
    const res = await fetch(`/api/account/reorder/${orderId}`, { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setLoading(false)
  }

  return (
    <button
      onClick={handleReorder}
      disabled={loading}
      style={{ background: '#c9a96e', color: '#000', border: 'none', padding: '7px 14px', borderRadius: '4px', fontSize: '11px', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}
    >
      {loading ? '...' : label}
    </button>
  )
}
