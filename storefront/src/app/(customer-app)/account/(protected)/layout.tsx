import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import Link from 'next/link'
import { PwaInstallBanner } from './_components/PwaInstallBanner'

export const metadata: Metadata = {
  manifest: '/manifest.json',
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const locale = await getAccountLocale()
  const t = getT(locale)

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0d0d', display: 'flex', flexDirection: 'column' }}>
      <script
        dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js'); window.addEventListener('beforeinstallprompt', function(e){ e.preventDefault(); window.__pwaInstallPrompt = e; });`,
        }}
      />
      <PwaInstallBanner />
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: '60px' }}>
        {children}
      </main>
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#0a0a0a', borderTop: '1px solid #1a1a1a',
        zIndex: 50,
      }}>
        {[
          { href: '/account', label: t('nav_home'), icon: '🏠' },
          { href: '/account/ordini', label: t('nav_orders'), icon: '📦' },
          { href: '/account/collezione', label: t('nav_collection'), icon: '🖼️' },
          { href: '/account/file', label: t('nav_files'), icon: '📁' },
          { href: '/account/profilo', label: t('nav_profile'), icon: '👤' },
        ].map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            style={{
              flex: 1, textAlign: 'center', padding: '10px 2px',
              color: '#555', fontSize: '9px', textTransform: 'uppercase',
              letterSpacing: '0.5px', textDecoration: 'none',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
            }}
          >
            <span style={{ fontSize: '18px' }}>{icon}</span>
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
