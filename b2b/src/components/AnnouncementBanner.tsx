import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { Announcement } from '@/lib/cms'

interface Props {
  announcement: Announcement
}

export async function AnnouncementBanner({ announcement }: Props) {
  const t = await getTranslations('Catalogo')

  return (
    <div style={{
      background: 'rgba(200,169,126,0.08)',
      border: '1px solid rgba(200,169,126,0.3)',
      borderRadius: '1rem',
      padding: '1.25rem 1.5rem',
      marginBottom: '3rem',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '1rem',
    }}>
      {/* Icona / badge */}
      <span style={{
        flexShrink: 0,
        fontSize: '0.6rem',
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--accent)',
        fontWeight: 600,
        marginTop: '0.15rem',
        whiteSpace: 'nowrap',
      }}>
        ✦ {t('annuncio')}
      </span>

      {/* Content + link */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: 'var(--font-cormorant)',
          fontStyle: 'italic',
          fontWeight: 600,
          fontSize: '1.1rem',
          color: 'var(--foreground)',
          marginBottom: announcement.body ? '0.4rem' : '0.75rem',
          lineHeight: 1.3,
        }}>
          {announcement.title}
        </p>
        {announcement.body && (
          <p style={{
            fontSize: '0.83rem',
            color: 'var(--muted-fg)',
            lineHeight: 1.65,
            marginBottom: '0.75rem',
          }}>
            {announcement.body}
          </p>
        )}
        <Link
          href="/offerte"
          style={{
            fontSize: '0.78rem',
            color: 'var(--accent)',
            textDecoration: 'none',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {t('leggiOfferta')}
        </Link>
      </div>
    </div>
  )
}
