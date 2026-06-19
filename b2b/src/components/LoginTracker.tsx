'use client'
import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, unknown>) => void }
  }
}

export function LoginTracker({ email }: { email: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    if (searchParams.get('_login') !== '1') return
    window.umami?.track('reseller_login', { email })
    router.replace('/catalogo')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
