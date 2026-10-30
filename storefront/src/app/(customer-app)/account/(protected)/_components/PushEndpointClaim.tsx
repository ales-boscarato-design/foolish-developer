'use client'
import { useEffect, useRef } from 'react'

/** Un solo nuovo tentativo, dopo dieci secondi, se il claim non riesce. */
const RETRY_DELAY_MS = 10_000
const MAX_ATTEMPTS = 2

/**
 * All'apertura della sessione autenticata cede al server l'endpoint push che
 * il browser ha gia'. Non iscrive, non chiede permessi e non mostra nulla.
 *
 * Il claim e' considerato riuscito solo dopo una risposta 2xx: un errore di
 * rete o un `!res.ok` schedulano un solo nuovo tentativo, poi si desiste in
 * silenzio.
 */
export function PushEndpointClaim() {
  const claimed = useRef(false)
  const running = useRef(false)

  useEffect(() => {
    let cancelled = false

    // StrictMode e doppi mount non devono inviare due volte.
    if (claimed.current || running.current) return
    running.current = true

    // Unico punto di rilascio: la guardia non deve restare chiusa per sempre
    // quando il claim non e' riuscito.
    function release(): void {
      running.current = false
    }

    let retryTimer: ReturnType<typeof setTimeout> | undefined

    async function claim(attempt: number): Promise<void> {
      if (cancelled) {
        release()
        return
      }

      try {
        if (typeof navigator === 'undefined') {
          release()
          return
        }
        if (!('serviceWorker' in navigator)) {
          release()
          return
        }

        const registration = await navigator.serviceWorker.getRegistration()
        // Registrazione assente: si esce senza attendere `ready` e senza crearne una.
        if (!registration) {
          release()
          return
        }

        const subscription = await registration.pushManager?.getSubscription()
        if (!subscription) {
          release()
          return
        }

        const endpoint = subscription.endpoint
        if (typeof endpoint !== 'string') {
          release()
          return
        }
        const cleaned = endpoint.trim()
        if (cleaned === '') {
          release()
          return
        }

        const res = await fetch('/api/account/push-claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: cleaned }),
        })

        if (res.ok) {
          // Fatto solo con una risposta 2xx del server.
          claimed.current = true
          return
        }

        scheduleRetry(attempt)
      } catch {
        // Silenzioso di proposito: un errore del claim non deve bloccare l'area personale.
        scheduleRetry(attempt)
      }
    }

    function scheduleRetry(attempt: number): void {
      if (cancelled || attempt >= MAX_ATTEMPTS) {
        // Si desiste (o il componente e' smontato): la guardia va rilasciata.
        release()
        return
      }
      retryTimer = setTimeout(() => {
        void claim(attempt + 1)
      }, RETRY_DELAY_MS)
    }

    void claim(1)

    return () => {
      cancelled = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [])

  return null
}
