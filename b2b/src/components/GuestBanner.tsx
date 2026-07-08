import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export async function GuestBanner() {
  const t = await getTranslations('Catalogo')

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '1rem',
      flexWrap: 'wrap',
      background: 'rgba(200,169,126,0.08)',
      border: '1px solid rgba(200,169,126,0.3)',
      borderRadius: '1rem',
      padding: '1.1rem 1.5rem',
      marginBottom: '3rem',
    }}>
      <p style={{
        fontSize: '0.85rem',
        color: 'var(--foreground)',
        margin: 0,
        lineHeight: 1.5,
      }}>
        {t('guestBannerBody')}
      </p>
      <Link
        href="/login"
        style={{
          flexShrink: 0,
          background: 'var(--accent)',
          color: 'var(--background)',
          padding: '0.55rem 1.25rem',
          borderRadius: '0.625rem',
          fontSize: '0.8rem',
          fontWeight: 600,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          letterSpacing: '0.02em',
        }}
      >
        {t('guestBannerCta')}
      </Link>
    </div>
  )
}
