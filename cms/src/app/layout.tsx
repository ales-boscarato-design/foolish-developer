import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Foolish Butcher — Admin',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  )
}
