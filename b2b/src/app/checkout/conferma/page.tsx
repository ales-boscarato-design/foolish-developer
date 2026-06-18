export default async function ConfermaPage({
  searchParams,
}: {
  searchParams: Promise<{ ordine?: string; metodo?: string }>
}) {
  const { ordine, metodo } = await searchParams
  const isBonifico = metodo === 'bonifico'

  return (
    <div style={{ maxWidth: '32rem', margin: '0 auto', marginTop: '4rem', textAlign: 'center' }}>
      <div style={{ fontSize: '4rem', color: 'var(--accent)', marginBottom: '1rem', lineHeight: 1 }}>✓</div>
      <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', marginBottom: '0.5rem' }}>
        Ordine confermato
      </h1>
      <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', marginBottom: '2rem' }}>
        Numero ordine: <strong style={{ color: 'var(--foreground)' }}>{ordine}</strong>
      </p>

      {isBonifico ? (
        <div style={{ background: 'rgba(200,169,126,0.06)', border: '1px solid rgba(200,169,126,0.2)', borderRadius: '1rem', padding: '1.5rem', textAlign: 'left', fontSize: '0.875rem' }}>
          <p style={{ fontWeight: 500, marginBottom: '1rem', color: 'var(--foreground)' }}>Coordinate per il bonifico:</p>
          <p style={{ marginBottom: '0.375rem', color: 'var(--muted-fg)' }}>
            Intestatario: <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>The Foolish Butcher Srl</span>
          </p>
          <p style={{ marginBottom: '0.375rem', color: 'var(--muted-fg)' }}>
            IBAN: <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 500, letterSpacing: '0.04em' }}>LT62 3250 0124 6419 4276</span>
          </p>
          <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
            Causale: {ordine} — inserisci il numero d&apos;ordine come causale.
          </p>
        </div>
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--muted-fg)' }}>Il pagamento è stato ricevuto.</p>
      )}

      <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginTop: '1.5rem', opacity: 0.7 }}>
        Hai ricevuto la conferma d&apos;ordine via email.
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
        Continua ad acquistare
      </a>
    </div>
  )
}
