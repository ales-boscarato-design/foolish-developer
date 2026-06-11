'use client'
import { useState } from 'react'

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={copy}
      style={{
        background: copied ? '#5a7a5a22' : '#1a1a1a',
        border: `1px solid ${copied ? '#5a7a5a' : '#c9a96e44'}`,
        borderRadius: '6px',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: 700, color: '#c9a96e', letterSpacing: '0.05em', flex: 1, textAlign: 'left' }}>
        {code}
      </span>
      <span style={{ fontSize: '11px', color: copied ? '#5a7a5a' : '#555' }}>
        {copied ? 'Copiato ✓' : 'Copia'}
      </span>
    </button>
  )
}
