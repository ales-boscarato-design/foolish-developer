'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Zone } from '@/lib/subscription-plans'

export function ChangeZoneButton({ subscriptionDocId, currentZone, label }: {
  subscriptionDocId: string
  currentZone: Zone
  label: string
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const otherZone: Zone = currentZone === 'IT' ? 'EU' : 'IT'

  async function handleChange() {
    setLoading(true)
    const res = await fetch('/api/account/subscription/change-zone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptionDocId, newZone: otherZone }),
    })
    setLoading(false)
    if (res.ok) router.refresh()
  }

  return (
    <button
      onClick={handleChange}
      disabled={loading}
      style={{
        background: 'transparent', border: '1px solid var(--border)', color: 'var(--accent)',
        borderRadius: '6px', padding: '8px 14px', fontSize: '11px', textTransform: 'uppercase',
        letterSpacing: '0.05em', cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.5 : 1,
      }}
    >
      {loading ? '...' : `${label} ${otherZone === 'IT' ? 'Italia' : 'Europa'}`}
    </button>
  )
}
