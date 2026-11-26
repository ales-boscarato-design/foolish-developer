'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { isPromoBarActive } from '@/lib/promo-bar'

export function PromoBar() {
  const t = useTranslations('promoBar')
  const [visible, setVisible] = useState<boolean | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(isPromoBarActive(new Date())))
    return () => cancelAnimationFrame(frame)
  }, [])

  if (!visible) return null

  return (
    <aside
      aria-label={t('textShort')}
      className="flex min-h-9 items-center justify-center gap-3 bg-[var(--accent)] px-3 py-1 text-center text-xs font-semibold uppercase tracking-wide text-black"
    >
      <span className="md:hidden">{t('textShort')}</span>
      <span className="hidden md:inline">{t('text')}</span>
      <span className="hidden text-[10px] font-normal normal-case tracking-normal md:inline">{t('note')}</span>
    </aside>
  )
}
