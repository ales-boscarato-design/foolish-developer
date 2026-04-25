'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ShoppingBag, Flame } from 'lucide-react'
import { useCart } from '@/lib/cart'

export function Nav() {
  const pathname = usePathname()
  const itemCount = useCart((s) => s.itemCount())

  const links = [
    { href: '/tattoo', label: 'Tattoo' },
    { href: '/pmu', label: 'PMU' },
    { href: '/limited', label: '🔥 Limited', accent: true },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-bold tracking-tight text-lg hover:text-[var(--accent)] transition-colors">
          THE FOOLISH BUTCHER
        </Link>

        <nav className="hidden md:flex items-center gap-6 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`transition-colors hover:text-[var(--accent)] ${
                pathname.startsWith(l.href)
                  ? 'text-[var(--accent)] font-medium'
                  : 'text-[var(--muted-fg)]'
              } ${l.accent ? 'text-[var(--limited)] hover:text-[var(--limited)]' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <Link href="/checkout" className="relative p-2 hover:text-[var(--accent)] transition-colors">
          <ShoppingBag size={20} />
          {itemCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-[var(--accent)] text-black text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
              {itemCount}
            </span>
          )}
        </Link>
      </div>
    </header>
  )
}
