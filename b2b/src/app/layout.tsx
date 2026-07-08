import type { Metadata } from 'next'
import { Outfit, Cormorant_Garamond } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { NavBar } from '@/components/NavBar'
import { getServerSession } from '@/lib/auth'
import Script from 'next/script'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const cormorant = Cormorant_Garamond({
  weight: ['400', '500', '600'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-cormorant',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Layout')
  return {
    title: `The Foolish Butcher — ${t('areaRivenditori')}`,
    robots: 'noindex, nofollow',
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  const session = await getServerSession()

  return (
    <html lang={locale} className={`${outfit.variable} ${cormorant.variable}`}>
      <body style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
        <Script
          src="https://umami-production-8b53.up.railway.app/script.js"
          data-website-id="99ca3a08-ff9b-4310-94ea-567d6a32d188"
          strategy="afterInteractive"
        />
        <NextIntlClientProvider messages={messages}>
          <header style={{
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'rgba(8,8,8,0.95)',
            backdropFilter: 'blur(12px)',
            position: 'sticky',
            top: 0,
            zIndex: 40,
            padding: '0 1.5rem',
          }}>
            <NavBar isLoggedIn={!!session} />
          </header>
          <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2.5rem 1.5rem' }}>
            {children}
          </main>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
