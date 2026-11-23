import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { NavBar } from '@/components/NavBar'
import { getServerSession } from '@/lib/auth'
import Script from 'next/script'
import './globals.css'
import './google-fonts.css'

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
  const umamiUrl = process.env.NEXT_PUBLIC_UMAMI_URL
  const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID

  return (
    <html lang={locale}>
      <head>
        <link
          rel="preload"
          href="/fonts/google/1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/google/8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/google/01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body style={{ backgroundColor: 'var(--background)', color: 'var(--foreground)', minHeight: '100vh' }}>
        {umamiUrl && umamiWebsiteId && (
          <Script
            src={`${umamiUrl}/script.js`}
            data-website-id={umamiWebsiteId}
            strategy="afterInteractive"
          />
        )}
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
