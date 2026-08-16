'use client'
import { useState, useEffect } from 'react'

declare global {
  interface Window {
    __pwaInstallPrompt?: { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null
  }
}

function isMobileBrowser() {
  if (typeof navigator === 'undefined') return false
  // iPadOS 13+ reports as Macintosh in desktop mode — catch via touch points
  const isIpadDesktop = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iphone|ipad|ipod|android/i.test(navigator.userAgent) || isIpadDesktop
}

function isIos() {
  if (typeof navigator === 'undefined') return false
  const isIpadDesktop = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || isIpadDesktop
}

function isInStandaloneMode() {
  return typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches
}

export function PwaInstallBanner() {
  const [show, setShow] = useState(false)
  const [ios] = useState(isIos)
  const [hasPrompt, setHasPrompt] = useState(() => (
    typeof window !== 'undefined' && Boolean(window.__pwaInstallPrompt)
  ))

  useEffect(() => {
    if (isInStandaloneMode()) return
    if (sessionStorage.getItem('pwa-banner-dismissed')) return
    if (!isMobileBrowser()) return

    // Also listen for it in case it fires after mount
    const handler = (e: Event) => {
      e.preventDefault()
      window.__pwaInstallPrompt = e as unknown as Window['__pwaInstallPrompt']
      setHasPrompt(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    const showTimer = window.setTimeout(() => setShow(true), 0)
    return () => {
      window.clearTimeout(showTimer)
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  function dismiss() {
    sessionStorage.setItem('pwa-banner-dismissed', '1')
    setShow(false)
  }

  async function install() {
    const prompt = window.__pwaInstallPrompt
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') {
      window.__pwaInstallPrompt = null
      setShow(false)
    }
  }

  if (!show) return null

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
        <div style={{ fontSize: '12px', color: '#c9a96e', fontWeight: 600, marginBottom: '4px' }}>
          Installa l&apos;app
        </div>
        {ios ? (
          <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5 }}>
            Tocca <strong style={{ color: '#aaa' }}>Condividi</strong> {' '}
            <span style={{ color: '#666' }}>⎙</span>{' '}
            poi <strong style={{ color: '#aaa' }}>Aggiungi a schermata Home</strong>.
          </div>
        ) : hasPrompt ? (
          <div>
            <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px' }}>
              Accesso rapido ai tuoi ordini dalla schermata Home.
            </div>
            <button onClick={install} style={{
              background: '#c9a96e', color: '#000', border: 'none',
              fontSize: '11px', fontWeight: 600, padding: '5px 12px',
              borderRadius: '4px', cursor: 'pointer',
            }}>
              Installa
            </button>
          </div>
        ) : (
          // Android without beforeinstallprompt (already prompted, or Chrome criteria not met yet)
          <div style={{ fontSize: '11px', color: '#888', lineHeight: 1.5 }}>
            Tocca il menu del browser <strong style={{ color: '#aaa' }}>⋮</strong> poi{' '}
            <strong style={{ color: '#aaa' }}>Aggiungi a schermata Home</strong>.
          </div>
        )}
      </div>
      <button
        onClick={dismiss}
        style={{ background: 'none', border: 'none', color: '#444', fontSize: '18px', cursor: 'pointer', padding: '0', lineHeight: 1, flexShrink: 0 }}
        aria-label="Chiudi"
      >
        ×
      </button>
    </div>
  )
}
