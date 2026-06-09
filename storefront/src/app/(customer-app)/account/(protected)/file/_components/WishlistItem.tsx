'use client'
import { useState } from 'react'

export function WishlistItemActions({ slug }: { slug: string; name: string }) {
  const [removed, setRemoved] = useState(false)

  async function handleRemove() {
    await fetch(`/api/account/wishlist?slug=${encodeURIComponent(slug)}`, { method: 'DELETE' })
    setRemoved(true)
  }

  if (removed) return null

  return (
    <button
      onClick={handleRemove}
      style={{ background: 'transparent', border: '1px solid #333', color: '#555', fontSize: '10px', padding: '4px 8px', borderRadius: '3px', cursor: 'pointer' }}
    >
      Rimuovi
    </button>
  )
}
