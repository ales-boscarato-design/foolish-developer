import type { Metadata } from 'next'
import { Outfit, Bebas_Neue } from 'next/font/google'
import '../globals.css'
import { Nav } from '@/components/Nav'
import { CartProvider } from '@/components/CartProvider'
import { InkThread } from '@/components/InkThread'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { routing } from '@/i18n/routing'
import { notFound } from 'next/navigation'
import { Footer } from '@/components/Footer'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-bebas' })

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

  if (!routing.locales.includes(locale as any)) notFound()

  const messages = await getMessages()

  return (
    <html lang={locale} className={`${outfit.variable} ${bebas.variable}`}>
      <body className="min-h-screen flex flex-col">
        <NextIntlClientProvider messages={messages}>
          <CartProvider>
            <InkThread />
            <Nav />
            <main className="flex-1">{children}</main>
            <Footer />
          </CartProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
