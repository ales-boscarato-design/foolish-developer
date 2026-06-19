import { getTranslations } from 'next-intl/server'
import { CartClearer } from '@/components/CartClearer'

export default async function ConfermaPage({
  searchParams,
}: {
  searchParams: Promise<{ ordine?: string; metodo?: string }>
}) {
  const { ordine, metodo } = await searchParams
  const isBonifico = metodo === 'bonifico'
  const t = await getTranslations('Conferma')

  return (
    <div style={{ maxWidth: '32rem', margin: '0 auto', marginTop: '4rem', textAlign: 'center' }}>
      <CartClearer />
      <div style={{ fontSize: '4rem', color: 'var(--accent)', marginBottom: '1rem', lineHeight: 1 }}>✓</div>
      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', marginBottom: '0.5rem' }}>
        {t('ordineConfermato')}
      </h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', marginBottom: '2rem' }}>
        {t('numeroOrdine')} <strong style={{ color: 'var(--foreground)' }}>{ordine}</strong>
      </p>

      {isBonifico ? (
        <div style={{ background: 'rgba(200,169,126,0.06)', border: '1px solid rgba(200,169,126,0.2)', borderRadius: '1rem', padding: '1.5rem', textAlign: 'left', fontSize: '0.875rem' }}>
          <p style={{ fontWeight: 500, marginBottom: '1rem', color: 'var(--foreground)' }}>{t('coordinateBonifico')}</p>
          <p style={{ marginBottom: '0.375rem', color: 'var(--muted-fg)' }}>
            {t('intestatario')} <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>The Foolish Butcher Srl</span>
          </p>
          <p style={{ marginBottom: '0.375rem', color: 'var(--muted-fg)' }}>
            {t('iban')} <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 500, letterSpacing: '0.04em' }}>LT62 3250 0124 6419 4276</span>
          </p>
          <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
            {t('causale', { ordine: ordine ?? '' })}
          </p>
        </div>
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--muted-fg)' }}>{t('pagamentoRicevuto')}</p>
      )}

      <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginTop: '1.5rem', opacity: 0.7 }}>
        {t('emailConferma')}
      </p>

      <a
        href="/catalogo"
        style={{
          display: 'inline-block',
          marginTop: '2.5rem',
          border: '1px solid var(--border)',
          borderRadius: '0.75rem',
          padding: '0.6rem 1.5rem',
          fontSize: '0.85rem',
          color: 'var(--foreground)',
          textDecoration: 'none',
        }}
      >
        {t('continuaAcquistare')}
      </a>
    </div>
  )
}
