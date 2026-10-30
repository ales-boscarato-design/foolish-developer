'use client'
import { useEffect, useRef } from 'react'

/**
 * All'apertura della sessione autenticata cede al server l'endpoint push che
 * il browser ha gia'. Non iscrive, non chiede permessi e non mostra nulla.
 */
export function PushEndpointClaim() {
  const claimed = useRef(false)

  useEffect(() => {
    // StrictMode e doppi mount non devono inviare due volte.
    if (claimed.current) return
    claimed.current = true

    async function claim() {
      try {
        if (typeof navigator === 'undefined') return
        if (!('serviceWorker' in navigator)) return

        const registration = await navigator.serviceWorker.getRegistration()
        // Registrazione assente: si esce senza attendere `ready` e senza crearne una.
        if (!registration) return

        const subscription = await registration.pushManager?.getSubscription()
        if (!subscription) return

        const endpoint = subscription.endpoint
        if (typeof endpoint !== 'string') return
        const cleaned = endpoint.trim()
        if (cleaned === '') return

        await fetch('/api/account/push-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: cleaned }),
        })
      } catch {
        // Silenzioso di proposito: un errore del claim non deve bloccare l'area personale.
      }
    }

    void claim()
  }, [])

  return null
}
