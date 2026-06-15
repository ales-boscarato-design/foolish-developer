import type { Metadata, Viewport } from 'next'
import { Outfit, Cormorant_Garamond } from 'next/font/google'
import Script from 'next/script'
import '../globals.css'
import { NavWrapper } from '@/components/NavWrapper'
import { CartProvider } from '@/components/CartProvider'
import { FluidCanvas } from '@/components/FluidCanvas'
import { SmoothScrollProvider } from '@/components/SmoothScrollProvider'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { notFound } from 'next/navigation'
import { Footer } from '@/components/Footer'

const BASE_URL = 'https://thefoolishbutcher.com'

const descriptions: Record<string, string> = {
  it: 'Pelle sintetica fatta a mano in Italia. Ogni foglio è unico — esattamente come la pelle dei tuoi clienti.',
  en: 'Handmade synthetic practice skin from Italy. Every sheet is unique — just like the skin of your clients.',
  fr: 'Peau synthétique artisanale faite main en Italie. Chaque feuille est unique — comme la peau de vos clients.',
  es: 'Piel sintética artesanal hecha a mano en Italia. Cada hoja es única — igual que la piel de tus clientes.',
  de: 'Handgefertigte synthetische Übungshaut aus Italien. Jedes Blatt ist einzigartig — genau wie die Haut deiner Kunden.',
}

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const cormorant = Cormorant_Garamond({
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-cormorant',
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return {
    metadataBase: new URL(BASE_URL),
    title: {
      default: 'The Foolish Butcher — Pelle sintetica artigianale per tattoo e PMU',
      template: '%s | The Foolish Butcher',
    },
    description: descriptions[locale] ?? descriptions.it,
    openGraph: {
      siteName: 'The Foolish Butcher',
      type: 'website',
      locale,
    },
    icons: {
      icon: '/favicon.ico',
      apple: '/apple-touch-icon.png',
    },
    robots: { index: true, follow: true },
    twitter: {
      card: 'summary_large_image',
      site: '@thefoolishbutcher',
      creator: '@thefoolishbutcher',
    },
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0d0d0d',
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params

  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) notFound()

  const messages = await getMessages()

  return (
    <html lang={locale} className={`${outfit.variable} ${cormorant.variable}`} suppressHydrationWarning>
      <body className="min-h-screen flex flex-col" suppressHydrationWarning>
        {process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
          <Script
            src={`${process.env.NEXT_PUBLIC_UMAMI_URL ?? 'https://analytics.thefoolishbutcher.com'}/script.js`}
            data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
            strategy="afterInteractive"
          />
        )}
        <SmoothScrollProvider>
          <NextIntlClientProvider messages={messages}>
            <CartProvider>
              <FluidCanvas />
              <NavWrapper />
              <main className="flex-1">{children}</main>
              <Footer />
            </CartProvider>
          </NextIntlClientProvider>
        </SmoothScrollProvider>
      </body>
    </html>
  )
}
