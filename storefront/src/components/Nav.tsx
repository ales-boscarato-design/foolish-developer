'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ShoppingBag, Menu, X } from 'lucide-react'
import { useCart } from '@/lib/cart'

const links = [
  { href: '/tattoo', label: 'Tattoo', accent: false },
  { href: '/pmu', label: 'PMU', accent: false },
  { href: '/limited', label: 'Limited', accent: true },
]

export function Nav() {
  const pathname = usePathname()
  const itemCount = useCart((s) => s.itemCount())
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="flex items-center opacity-90 hover:opacity-100 transition-opacity"
          onClick={() => setOpen(false)}
        >
          <Image
            src="/logo%20foolish/logo.png"
            alt="The Foolish Butcher"
            width={140}
            height={36}
            className="h-8 w-auto"
            priority
          />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`transition-colors hover:text-[var(--accent)] ${
                pathname.startsWith(l.href) ? 'text-[var(--accent)] font-medium' : 'text-[var(--muted-fg)]'
              } ${l.accent ? 'text-[var(--limited)] hover:text-[var(--limited)]' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right side: cart + hamburger */}
        <div className="flex items-center gap-1">
          <Link href="/checkout" className="relative p-2 hover:text-[var(--accent)] transition-colors">
            <ShoppingBag size={20} />
            {itemCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-[var(--accent)] text-black text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {itemCount}
              </span>
            )}
          </Link>

          <button
            className="md:hidden p-2 hover:text-[var(--accent)] transition-colors"
            aria-label={open ? 'Chiudi menu' : 'Apri menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <nav
          className="md:hidden border-t border-[var(--border)]"
          style={{ backgroundColor: 'var(--background)' }}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-6 py-4 text-sm font-medium tracking-wide border-b border-[var(--border)] transition-colors hover:text-[var(--accent)] ${
                pathname.startsWith(l.href) ? 'text-[var(--accent)]' : 'text-[var(--muted-fg)]'
              } ${l.accent ? 'text-[var(--limited)] hover:text-[var(--limited)]' : ''}`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  )
}
