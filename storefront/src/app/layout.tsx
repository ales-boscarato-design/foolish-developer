import type { Metadata } from 'next'
import { Outfit, Bebas_Neue } from 'next/font/google'
import './globals.css'
import { Nav } from '@/components/Nav'
import { CartProvider } from '@/components/CartProvider'
import { InkThread } from '@/components/InkThread'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const bebas = Bebas_Neue({ weight: '400', subsets: ['latin'], variable: '--font-bebas' })

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
    <html lang="it" className={`${outfit.variable} ${bebas.variable}`}>
      <body className="min-h-screen flex flex-col">
        <CartProvider>
          <InkThread />
          <Nav />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-[var(--border)] py-10 px-4 text-center text-sm text-[var(--muted-fg)] space-y-2">
            <p>© 2012–{new Date().getFullYear()} The Foolish Butcher · Tutti i diritti riservati</p>
            <p>P.IVA IT12475480013 · Tutti i prezzi IVA inclusa · Chieri (TO), Italia</p>
            <p className="flex justify-center gap-4 flex-wrap">
              <a href="/contatti" className="hover:text-[var(--fg)] transition-colors">Contatti</a>
              <a href="/termini" className="hover:text-[var(--fg)] transition-colors">Termini e condizioni</a>
              <a href="/privacy" className="hover:text-[var(--fg)] transition-colors">Privacy policy</a>
            </p>
          </footer>
        </CartProvider>
      </body>
    </html>
  )
}
