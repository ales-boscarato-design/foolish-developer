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
    const param = searchParams.get('_login') === '1'
      ? 'login'
      : searchParams.get('_register') === '1'
        ? 'register'
        : null
    if (!param) return

    if (param === 'login') window.umami?.track('reseller_login', { email })
    if (param === 'register') window.umami?.track('reseller_register', { email })

    router.replace('/catalogo')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
