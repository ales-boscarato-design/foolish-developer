import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'The Foolish Butcher — Area Rivenditori',
  robots: 'noindex, nofollow',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body className="bg-stone-50 text-stone-900 min-h-screen font-sans antialiased">
        <header className="border-b border-stone-200 bg-white px-6 py-4 flex items-center justify-between">
          <span className="font-semibold tracking-tight">The Foolish Butcher — Rivenditori</span>
          <nav className="flex gap-4 text-sm">
            <a href="/catalogo" className="hover:underline">Catalogo</a>
            <a href="/carrello" className="hover:underline">Carrello</a>
            <a href="/account" className="hover:underline">Account</a>
            <a href="/api/auth/logout" className="text-stone-400 hover:underline">Esci</a>
          </nav>
        </header>
        <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>
      </body>
    </html>
  )
}
