'use client'
import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/account/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0d0d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ maxWidth: '360px', width: '100%' }}>
        <div style={{ fontSize: '11px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '24px' }}>
          The Foolish Butcher
        </div>
        {sent ? (
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 300, color: '#fff', marginBottom: '12px' }}>Controlla la tua email</h1>
            <p style={{ color: '#666', fontSize: '13px' }}>
              Ti abbiamo inviato un link di accesso a <strong style={{ color: '#aaa' }}>{email}</strong>. Scade in 15 minuti.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 style={{ fontSize: '22px', fontWeight: 300, color: '#fff', marginBottom: '8px' }}>La tua area</h1>
            <p style={{ color: '#666', fontSize: '13px', marginBottom: '24px' }}>
              Inserisci la tua email per ricevere il link di accesso.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@esempio.it"
              required
              style={{
                width: '100%', padding: '12px', background: '#111', border: '1px solid #333',
                borderRadius: '6px', color: '#fff', fontSize: '14px', boxSizing: 'border-box',
                marginBottom: '12px', outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '12px', background: '#c9a96e', color: '#000',
                border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Invio...' : 'Invia link →'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
