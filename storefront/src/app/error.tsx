'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold mb-4" style={{ color: 'var(--accent)' }}>!</p>
      <h1 className="text-xl font-semibold mb-2">Qualcosa è andato storto</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-fg)' }}>
        Si è verificato un errore inatteso. Riprova o torna allo shop.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-6 py-3 rounded font-semibold text-sm border transition-opacity hover:opacity-80"
          style={{ borderColor: 'var(--border)' }}
        >
          Riprova
        </button>
        <Link
          href="/"
          className="px-6 py-3 rounded font-semibold text-sm transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'var(--accent)', color: 'black' }}
        >
          Torna allo shop
        </Link>
      </div>
    </div>
  )
}
