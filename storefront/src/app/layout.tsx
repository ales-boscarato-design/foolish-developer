import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/Nav'
import { CartProvider } from '@/components/CartProvider'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })

export const metadata: Metadata = {
  title: 'The Foolish Butcher — Pelle sintetica artigianale per tattoo e PMU',
  description:
    'Pelle sintetica fatta a mano in Italia. Ogni foglio è unico — esattamente come la pelle dei tuoi clienti.',
  openGraph: {
    title: 'The Foolish Butcher',
    description: 'Pelle sintetica artigianale per tattoo e PMU. Made in Italy.',
    url: 'https://thefoolishbutcher.com',
    siteName: 'The Foolish Butcher',
    locale: 'it_IT',
    type: 'website',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={outfit.variable}>
      <body className="min-h-screen flex flex-col">
        <CartProvider>
          <Nav />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-[var(--border)] py-8 px-4 text-center text-sm text-[var(--muted-fg)]">
            <p>© {new Date().getFullYear()} The Foolish Butcher — Chieri (TO), Italia</p>
            <p className="mt-1">P.IVA IT12345678901 · Tutti i prezzi IVA inclusa</p>
          </footer>
        </CartProvider>
      </body>
    </html>
  )
}
