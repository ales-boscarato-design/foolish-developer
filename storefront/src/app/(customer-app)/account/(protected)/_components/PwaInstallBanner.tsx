'use client'
import { useState, useEffect } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaInstallBanner() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isIos, setIsIos] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Already installed (standalone mode) — don't show banner
    if (window.matchMedia('(display-mode: standalone)').matches) return
    // Already dismissed this session
    if (sessionStorage.getItem('pwa-banner-dismissed')) { setDismissed(true); return }

    // iOS detection (no beforeinstallprompt on Safari)
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !('BeforeInstallPromptEvent' in window)
    if (ios) { setIsIos(true); return }

    // Android/Chrome
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  function dismiss() {
    sessionStorage.setItem('pwa-banner-dismissed', '1')
    setDismissed(true)
    setInstallPrompt(null)
    setIsIos(false)
  }

  async function install() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setDismissed(true)
    setInstallPrompt(null)
  }

  if (dismissed || (!installPrompt && !isIos)) return null

  return (
    <div style={{
      margin: '12px 16px 0',
      background: '#111',
      border: '1px solid #c9a96e33',
      borderRadius: '8px',
      padding: '12px 14px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
    }}>
      <div style={{ fontSize: '20px', lineHeight: 1 }}>📲</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isIos ? (
          <>
            <div style={{ fontSize: '12px', color: '#c9a96e', fontWeight: 600, marginBottom: '4px' }}>
              Installa l&apos;app
            </div>
            <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5 }}>
              Tocca <strong style={{ color: '#aaa' }}>Condividi</strong> → <strong style={{ color: '#aaa' }}>Aggiungi a schermata Home</strong> per accedere ai tuoi ordini senza aprire il browser.
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: '12px', color: '#c9a96e', fontWeight: 600, marginBottom: '4px' }}>
              Installa l&apos;app
            </div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
              Aggiungi alla schermata Home per accesso rapido ai tuoi ordini.
            </div>
            <button
              onClick={install}
              style={{
                background: '#c9a96e', color: '#000', border: 'none',
                fontSize: '11px', fontWeight: 600, padding: '5px 12px',
                borderRadius: '4px', cursor: 'pointer',
              }}
            >
              Installa
            </button>
          </>
        )}
      </div>
      <button
        onClick={dismiss}
        style={{ background: 'none', border: 'none', color: '#444', fontSize: '16px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}
        aria-label="Chiudi"
      >
        ×
      </button>
    </div>
  )
}
