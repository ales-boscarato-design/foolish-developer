import type { Metadata } from 'next'
import { Outfit, Cormorant_Garamond } from 'next/font/google'
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

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const cormorant = Cormorant_Garamond({
  weight: ['300', '400', '500', '600', '700'],
  style: ['normal', 'italic'],
  subsets: ['latin'],
  variable: '--font-cormorant',
})

export const metadata: Metadata = {
  title: 'The Foolish Butcher — Pelle sintetica artigianale per tattoo e PMU',
  description:
    'Pelle sintetica fatta a mano in Italia. Ogni foglio è unico — esattamente come la pelle dei tuoi clienti.',
  openGraph: {
    title: 'The Foolish Butcher',
    description: 'Artisanal synthetic skin for tattoo and PMU practice. Made in Italy.',
    url: 'https://thefoolishbutcher.com',
    siteName: 'The Foolish Butcher',
    type: 'website',
  },
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
