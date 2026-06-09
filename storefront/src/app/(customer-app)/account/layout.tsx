import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import Link from 'next/link'

export const metadata: Metadata = {
  manifest: '/manifest.json',
  themeColor: '#0d0d0d',
}

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/account/login')

  return (
    <div style={{ minHeight: '100dvh', background: '#0d0d0d', display: 'flex', flexDirection: 'column' }}>
      <script
        dangerouslySetInnerHTML={{
          __html: `if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js')`,
        }}
      />
      <main style={{ flex: 1, overflowY: 'auto', paddingBottom: '60px' }}>
        {children}
      </main>
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        display: 'flex', background: '#0a0a0a', borderTop: '1px solid #1a1a1a',
        zIndex: 50,
      }}>
        {[
          { href: '/account', label: 'Home', icon: '🏠' },
          { href: '/account/ordini', label: 'Ordini', icon: '📦' },
          { href: '/account/collezione', label: 'Collezione', icon: '🖼️' },
          { href: '/account/file', label: 'File', icon: '📁' },
          { href: '/account/profilo', label: 'Profilo', icon: '👤' },
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
