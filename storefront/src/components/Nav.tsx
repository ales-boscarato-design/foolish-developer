'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ShoppingBag, Menu, X } from 'lucide-react'
import { motion, useScroll, useTransform, useSpring } from 'framer-motion'
import { useCart } from '@/lib/cart'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { useLocale } from 'next-intl'
import { routing } from '@/i18n/routing'

const links = [
  { href: '/tattoo' as const, label: 'Tattoo', accent: false },
  { href: '/pmu' as const, label: 'PMU', accent: false },
  { href: '/limited' as const, label: '🔥 Limited', accent: true },
]

const LOCALE_LABELS: Record<string, string> = {
  it: 'IT', en: 'EN', fr: 'FR', es: 'ES', de: 'DE',
}

function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const handleLocaleChange = (newLocale: string) => {
    if (newLocale === locale) return
    router.push(pathname, { locale: newLocale })
  }

  return (
    <div className={`flex items-center gap-1 text-xs ${className ?? ''}`}>
      {routing.locales.map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span className="mx-0.5 opacity-20">·</span>}
          <button
            onClick={() => handleLocaleChange(l)}
            className={`transition-colors ${
              l === locale
                ? 'text-[var(--accent)] font-semibold'
                : 'text-[var(--muted-fg)] hover:text-[var(--foreground)]'
            }`}
          >
            {LOCALE_LABELS[l]}
          </button>
        </span>
      ))}
    </div>
  )
}

export function Nav() {
  const pathname = usePathname()
  const itemCount = useCart((s) => s.itemCount())
  const [open, setOpen] = useState(false)

  const { scrollY, scrollYProgress } = useScroll()

  const rawP = useTransform(scrollY, [0, 110], [0, 1])
  const p = useSpring(rawP, { stiffness: 80, damping: 22, mass: 0.55 })

  const barHeight = useTransform(p, [0, 1], [140, 60])
  const logoH = useTransform(p, [0, 1], [150, 30])
  const bgOpacity = useTransform(p, [0, 1], [0, 0.96])
  const borderOpacity = useTransform(p, [0.3, 1], [0, 1])

  const readP = useSpring(scrollYProgress, { stiffness: 80, damping: 28 })

  return (
    <>
      <motion.header
        className="sticky top-0 z-50"
        style={{ height: barHeight }}
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <motion.div
          className="absolute inset-0 backdrop-blur-md"
          style={{ opacity: bgOpacity, backgroundColor: 'var(--background)' }}
        />
        <motion.div
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ opacity: borderOpacity, backgroundColor: 'var(--border)' }}
        />
        <motion.div
          className="absolute inset-x-0 bottom-0 h-px origin-left"
          style={{ scaleX: readP, backgroundColor: 'var(--accent)', zIndex: 1 }}
        />

        <div className="relative h-full max-w-6xl mx-auto px-6 flex items-center justify-between">

          <Link
            href="/"
            className="flex-shrink-0 opacity-90 hover:opacity-100 transition-opacity"
            onClick={() => setOpen(false)}
          >
            <motion.div style={{ height: logoH }}>
              <Image
                src="/logo%20foolish/logo.png"
                alt="The Foolish Butcher"
                width={240}
                height={64}
                className="h-full w-auto object-contain object-left"
                priority
              />
            </motion.div>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6 text-sm">
            {links.map((l, i) => (
              <motion.div
                key={l.href}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.08, duration: 0.4, ease: 'easeOut' }}
              >
                <Link
                  href={l.href}
                  className={`tracking-wide transition-colors hover:text-[var(--accent)] ${
                    pathname.startsWith(l.href)
                      ? 'text-[var(--accent)] font-medium'
                      : 'text-[var(--muted-fg)]'
                  } ${l.accent ? '!text-[var(--limited)] hover:!text-[var(--limited)]' : ''}`}
                >
                  {l.label}
                </Link>
              </motion.div>
            ))}
          </nav>

          {/* Cart + locale switcher + hamburger */}
          <motion.div
            className="flex items-center gap-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.4 }}
          >
            <LocaleSwitcher className="hidden md:flex" />
            <Link
              href="/checkout"
              className="relative p-2 hover:text-[var(--accent)] transition-colors"
            >
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
          </motion.div>
        </div>
      </motion.header>

      {/* Mobile drawer */}
      {open && (
        <nav
          className="fixed inset-x-0 z-40 border-b md:hidden"
          style={{
            top: 60,
            backgroundColor: 'var(--background)',
            borderColor: 'var(--border)',
          }}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block px-6 py-4 text-sm font-medium tracking-wide border-b transition-colors hover:text-[var(--accent)] ${
                pathname.startsWith(l.href) ? 'text-[var(--accent)]' : 'text-[var(--muted-fg)]'
              } ${l.accent ? '!text-[var(--limited)] hover:!text-[var(--limited)]' : ''}`}
              style={{ borderColor: 'var(--border)' }}
            >
              {l.label}
            </Link>
          ))}
          <Link
            href="/contatti"
            onClick={() => setOpen(false)}
            className={`block px-6 py-4 text-sm font-medium tracking-wide border-b transition-colors hover:text-[var(--accent)] ${
              pathname === '/contatti' ? 'text-[var(--accent)]' : 'text-[var(--muted-fg)]'
            }`}
            style={{ borderColor: 'var(--border)' }}
          >
            Contatti
          </Link>
          <div className="px-6 py-4 flex items-center gap-1">
            <LocaleSwitcher />
          </div>
        </nav>
      )}
    </>
  )
}
