'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function CancelSubscriptionButton({ subscriptionDocId, label, confirmLabel }: {
  subscriptionDocId: string
  label: string
  confirmLabel: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleCancel() {
    if (!confirm(confirmLabel)) return
    setLoading(true)
    const res = await fetch('/api/account/subscription/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionDocId }),
    })
    setLoading(false)
    if (res.ok) router.refresh()
  }

  return (
    <button
      onClick={handleCancel}
      disabled={loading}
      style={{
        background: 'transparent', border: '1px solid #5a2a2a', color: '#c07a7a',
        borderRadius: '6px', padding: '8px 14px', fontSize: '11px', textTransform: 'uppercase',
        letterSpacing: '0.05em', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : label}
    </button>
  )
}
