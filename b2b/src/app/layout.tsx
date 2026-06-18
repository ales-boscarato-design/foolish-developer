import type { Metadata } from 'next'
import { Outfit, Cormorant_Garamond } from 'next/font/google'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const cormorant = Cormorant_Garamond({
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-cormorant',
})

export const metadata: Metadata = {
  title: 'The Foolish Butcher — Area Rivenditori',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${outfit.variable} ${cormorant.variable}`}>
      <body style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
        <header style={{
          borderBottom: '1px solid var(--border)',
          backgroundColor: 'rgba(8,8,8,0.95)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          padding: '0 1.5rem',
        }}>
          <div style={{ maxWidth: '72rem', margin: '0 auto', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 600, fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--accent)', letterSpacing: '0.01em' }}>
                The Foolish Butcher
              </span>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', display: 'block', marginTop: '-2px' }}>
                Area Rivenditori
              </span>
            </div>
            <nav style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              {[
                { href: '/catalogo', label: 'Catalogo' },
                { href: '/carrello', label: 'Carrello' },
                { href: '/account', label: 'Account' },
              ].map(item => (
                <a key={item.href} href={item.href} style={{
                  padding: '0.4rem 0.75rem',
                  fontSize: '0.8rem',
                  color: 'var(--muted-fg)',
                  textDecoration: 'none',
                  borderRadius: '0.5rem',
                  transition: `color var(--dur-fast), background var(--dur-fast)`,
                  letterSpacing: '0.04em',
                }}>
                  {item.label}
                </a>
              ))}
              <a href="/api/auth/logout" style={{
                padding: '0.4rem 0.75rem',
                fontSize: '0.75rem',
                color: 'var(--muted-fg)',
                textDecoration: 'none',
                borderRadius: '0.5rem',
                opacity: 0.5,
                letterSpacing: '0.04em',
              }}>
                Esci
              </a>
            </nav>
          </div>
        </header>
        <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
          {children}
        </main>
      </body>
    </html>
  )
}
