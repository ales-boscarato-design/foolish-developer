'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ShoppingBag, Menu, X } from 'lucide-react'
import { motion, useScroll, useTransform, useSpring } from 'framer-motion'
import { useCart } from '@/lib/cart'

const links = [
  { href: '/tattoo', label: 'Tattoo', accent: false },
  { href: '/pmu', label: 'PMU', accent: false },
  { href: '/limited', label: '🔥 Limited', accent: true },
]

export function Nav() {
  const pathname = usePathname()
  const itemCount = useCart((s) => s.itemCount())
  const [open, setOpen] = useState(false)

  const { scrollY, scrollYProgress } = useScroll()

  // 0 = top, 1 = scrolled (transizione nei primi 110px)
  const rawP = useTransform(scrollY, [0, 110], [0, 1])
  const p = useSpring(rawP, { stiffness: 80, damping: 22, mass: 0.55 })

  // Altezza barra: 130 → 60
  const barHeight = useTransform(p, [0, 1], [140, 60])
  // Logo height: 100 → 30
  const logoH = useTransform(p, [0, 1], [120, 30])
  // Background: trasparente → opaco
  const bgOpacity = useTransform(p, [0, 1], [0, 0.96])
  // Border + elementi extra: appaiono dopo metà transizione
  const borderOpacity = useTransform(p, [0.3, 1], [0, 1])

  // Linea progress lettura (accent, bottom del nav)
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
        {/* Layer background — si opacizza con lo scroll */}
        <motion.div
          className="absolute inset-0 backdrop-blur-md"
          style={{
            opacity: bgOpacity,
            backgroundColor: 'var(--background)',
          }}
        />

        {/* Bordo inferiore — appare con lo scroll */}
        <motion.div
          className="absolute inset-x-0 bottom-0 h-px"
          style={{
            opacity: borderOpacity,
            backgroundColor: 'var(--border)',
          }}
        />

        {/* Linea progress lettura (accent, sopra il bordo) */}
        <motion.div
          className="absolute inset-x-0 bottom-0 h-px origin-left"
          style={{
            scaleX: readP,
            backgroundColor: 'var(--accent)',
            zIndex: 1,
          }}
        />

        {/* Contenuto nav */}
        <div className="relative h-full max-w-6xl mx-auto px-6 flex items-center justify-between">

          {/* Logo */}
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

          {/* Desktop nav — stagger su mount */}
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

          {/* Cart + hamburger */}
          <motion.div
            className="flex items-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45, duration: 0.4 }}
          >
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

      {/* Mobile drawer — anchored a 60px (altezza sticky) */}
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
        </nav>
      )}
    </>
  )
}
