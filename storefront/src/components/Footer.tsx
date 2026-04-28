'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

export function Footer() {
  const t = useTranslations('footer')
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-[var(--border)] py-10 px-4 text-center text-sm text-[var(--muted-fg)] space-y-2">
      <p>{t('copyright', { year })}</p>
      <p>{t('vat')}</p>
      <p className="flex justify-center gap-4 flex-wrap">
        <Link href="/contatti" className="hover:text-[var(--fg)] transition-colors">{t('contacts')}</Link>
        <Link href="/termini" className="hover:text-[var(--fg)] transition-colors">{t('terms')}</Link>
        <Link href="/privacy" className="hover:text-[var(--fg)] transition-colors">{t('privacy')}</Link>
      </p>
    </footer>
  )
}
