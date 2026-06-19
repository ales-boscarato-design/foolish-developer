'use client'
import { useCart } from '@/lib/cart'
import { calculateLineTotal, formatPrice } from '@/lib/pricing'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

export default function CarrelloPage() {
  const { items, updateQty, removeItem, total } = useCart()
  const t = useTranslations('Carrello')

  if (items.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '5rem 0' }}>
        <p style={{ color: 'var(--muted-fg)', marginBottom: '1.5rem' }}>{t('vuoto')}</p>
        <Link href="/catalogo" style={{
          display: 'inline-block',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '0.6rem 1.25rem',
          fontSize: '0.85rem',
          color: 'var(--foreground)',
          textDecoration: 'none',
        }}>
          {t('tornaCatalogo')}
        </Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '680px' }}>
      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', marginBottom: '2rem' }}>
        {t('titolo')}
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {items.map((item, idx) => {
          const lineTotal = calculateLineTotal(item.unitPrice, item.qty, item.priceTiers)
          return (
            <div key={item.variantSku} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              padding: '1.25rem 0',
              borderTop: idx > 0 ? '1px solid var(--border)' : undefined,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 500, fontSize: '0.9rem', marginBottom: '0.2rem' }}>{item.productName}</p>
                <p style={{ fontSize: '0.78rem', color: 'var(--muted-fg)' }}>{item.variantLabel}</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid var(--border)', borderRadius: '0.5rem', overflow: 'hidden' }}>
                <button onClick={() => updateQty(item.variantSku, item.qty - 1)} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: 'none', color: 'var(--foreground)', cursor: 'pointer', fontSize: '1rem' }}>−</button>
                <span style={{ padding: '0.4rem 0.5rem', fontSize: '0.85rem', minWidth: '2rem', textAlign: 'center' }}>{item.qty}</span>
                <button onClick={() => updateQty(item.variantSku, item.qty + 1)} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: 'none', color: 'var(--foreground)', cursor: 'pointer', fontSize: '1rem' }}>+</button>
              </div>
              <div style={{ fontSize: '0.9rem', fontWeight: 500, minWidth: '80px', textAlign: 'right', color: 'var(--accent)' }}>
                {formatPrice(lineTotal)}
              </div>
              <button onClick={() => removeItem(item.variantSku)} style={{ background: 'transparent', border: 'none', color: 'var(--muted-fg)', cursor: 'pointer', fontSize: '0.75rem', opacity: 0.5, padding: '0.25rem' }}>✕</button>
            </div>
          )
        })}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: '0.5rem', paddingTop: '1.5rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted-fg)', marginBottom: '0.25rem' }}>{t('totaleIva')}</p>
          <p style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--accent)', fontFamily: 'var(--font-cormorant)', fontStyle: 'italic' }}>{formatPrice(total())}</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--muted-fg)', marginTop: '0.25rem' }}>{t('spedizione')}</p>
        </div>
        <Link href="/checkout" style={{
          background: 'var(--accent)',
          color: '#000',
          borderRadius: '0.75rem',
          padding: '0.75rem 1.75rem',
          fontSize: '0.875rem',
          fontWeight: 600,
          textDecoration: 'none',
          letterSpacing: '0.02em',
        }}>
          {t('checkout')}
        </Link>
      </div>
    </div>
  )
}
