'use client'
import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useCart } from '@/lib/cart'
import { useTranslations, useLocale } from 'next-intl'
import { LocaleSwitcher } from './LocaleSwitcher'
import Link from 'next/link'

function BagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 01-8 0" />
    </svg>
  )
}

function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <line x1="3" y1="7" x2="21" y2="7" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="17" x2="21" y2="17" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

const LOCALES = [
  { code: 'it', label: 'IT' },
  { code: 'fr', label: 'FR' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
]

function switchLocale(code: string) {
  document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000; SameSite=Lax`
  window.location.reload()
}

function CartBadge({ count, onClick }: { count: number; onClick?: () => void }) {
  return (
    <Link
      href="/carrello"
      onClick={onClick}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', padding: '0.4rem 0.5rem', color: 'var(--foreground)', textDecoration: 'none' }}
      aria-label={`Carrello${count > 0 ? `, ${count} prodotti` : ''}`}
    >
      <BagIcon />
      {count > 0 && (
        <span style={{
          position: 'absolute', top: '1px', right: '-2px',
          backgroundColor: 'var(--accent)', color: '#080808',
          fontSize: '0.6rem', fontWeight: 700,
          minWidth: '16px', height: '16px',
          borderRadius: '99px', padding: '0 3px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </Link>
  )
}

export function NavBar() {
  const { items } = useCart()
  const t = useTranslations('Layout')
  const locale = useLocale()
  const [menuOpen, setMenuOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const cartCount = items.reduce((sum, i) => sum + i.qty, 0)

  const navLinks = [
    { href: '/catalogo', label: t('catalogo') },
    { href: '/account', label: t('account') },
  ]

  return (
    <>
      {/* ── Header ── */}
      <div className="header-inner">
        <Link href="/catalogo" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 600, fontStyle: 'italic', fontSize: '1.1rem', color: 'var(--accent)', letterSpacing: '0.01em', display: 'block' }}>
            The Foolish Butcher
          </span>
          <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', display: 'block', marginTop: '-2px' }}>
            {t('areaRivenditori')}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="desktop-nav">
          {navLinks.map(item => (
            <a key={item.href} href={item.href} style={{
              padding: '0.4rem 0.75rem', fontSize: '0.8rem',
              color: 'var(--muted-fg)', textDecoration: 'none',
              borderRadius: '0.5rem', letterSpacing: '0.04em',
            }}>
              {item.label}
            </a>
          ))}
          <CartBadge count={cartCount} />
          <LocaleSwitcher />
          <a href="/api/auth/logout" style={{
            padding: '0.4rem 0.75rem', fontSize: '0.75rem',
            color: 'var(--muted-fg)', textDecoration: 'none',
            borderRadius: '0.5rem', opacity: 0.5, letterSpacing: '0.04em',
          }}>
            {t('esci')}
          </a>
        </nav>

        {/* Mobile controls */}
        <div className="mobile-nav-controls">
          <CartBadge count={cartCount} />
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Apri menu"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground)', padding: '0.4rem', display: 'flex', alignItems: 'center' }}
          >
            <HamburgerIcon />
          </button>
        </div>
      </div>

      {/* ── Mobile drawer ── */}
      {menuOpen && mounted && createPortal(
        <>
          {/* Scrim */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.7)' }}
          />

          {/* Pannello — z-index sopra lo scrim, background solido */}
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0,
              width: 'min(85vw, 300px)',
              zIndex: 201,
              backgroundColor: '#1a1714',
              borderLeft: '1px solid rgba(200,169,126,0.2)',
              boxShadow: '-12px 0 48px rgba(0,0,0,0.9)',
              display: 'flex', flexDirection: 'column',
              padding: '1.25rem 1.5rem',
              overflowY: 'auto',
            }}
          >
            {/* Header drawer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)' }}>
                Menu
              </span>
              <button
                onClick={() => setMenuOpen(false)}
                aria-label="Chiudi menu"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted-fg)', padding: '0.25rem', display: 'flex' }}
              >
                <CloseIcon />
              </button>
            </div>

            {/* Nav links */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              {navLinks.map(item => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  style={{
                    padding: '1rem 0', fontSize: '1rem',
                    color: '#f0ede8', textDecoration: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    letterSpacing: '0.01em',
                  }}
                >
                  {item.label}
                </a>
              ))}

              {/* Carrello con badge */}
              <a
                href="/carrello"
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: '1rem 0', fontSize: '1rem',
                  color: '#f0ede8', textDecoration: 'none',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                {t('carrello')}
                {cartCount > 0 && (
                  <span style={{
                    backgroundColor: 'var(--accent)', color: '#080808',
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '0.15rem 0.6rem', borderRadius: '99px',
                  }}>
                    {cartCount}
                  </span>
                )}
              </a>
            </div>

            {/* Lingua + Esci */}
            <div style={{ paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              <p style={{ fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
                Lingua
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {LOCALES.map(({ code, label }) => (
                  <button
                    key={code}
                    onClick={() => switchLocale(code)}
                    disabled={code === locale}
                    style={{
                      backgroundColor: code === locale ? 'rgba(200,169,126,0.15)' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${code === locale ? 'var(--accent)' : 'rgba(255,255,255,0.12)'}`,
                      padding: '0.4rem 0.875rem', fontSize: '0.8rem',
                      fontWeight: code === locale ? 600 : 400,
                      color: code === locale ? 'var(--accent)' : '#f0ede8',
                      cursor: code === locale ? 'default' : 'pointer',
                      borderRadius: '0.5rem',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <a
                href="/api/auth/logout"
                style={{ display: 'block', marginTop: '1.5rem', fontSize: '0.8rem', color: 'var(--muted-fg)', textDecoration: 'none', opacity: 0.6 }}
              >
                {t('esci')} →
              </a>
            </div>
          </div>
        </>,
        document.body
      )}
    </>
  )
}
