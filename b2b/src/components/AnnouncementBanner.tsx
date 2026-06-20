import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import type { Announcement } from '@/lib/cms'

interface Props {
  announcement: Announcement
}

export async function AnnouncementBanner({ announcement }: Props) {
  const t = await getTranslations('Catalogo')
  const locale = await getLocale()

  const title =
    (locale === 'en' && announcement.titleEn) ||
    (locale === 'fr' && announcement.titleFr) ||
    (locale === 'es' && announcement.titleEs) ||
    (locale === 'de' && announcement.titleDe) ||
    announcement.title

  const body =
    (locale === 'en' && announcement.bodyEn) ||
    (locale === 'fr' && announcement.bodyFr) ||
    (locale === 'es' && announcement.bodyEs) ||
    (locale === 'de' && announcement.bodyDe) ||
    announcement.body || undefined

  return (
    <div style={{
      background: 'rgba(200,169,126,0.08)',
      border: '1px solid rgba(200,169,126,0.3)',
      borderRadius: '1rem',
      padding: '1.25rem 1.5rem',
      marginBottom: '3rem',
    }}>
      <span style={{
        display: 'block',
        fontSize: '0.6rem',
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        color: 'var(--accent)',
        fontWeight: 600,
        marginBottom: '0.6rem',
      }}>
        ✦ {t('annuncio')}
      </span>

      <p style={{
        fontFamily: 'var(--font-cormorant)',
        fontStyle: 'italic',
        fontWeight: 600,
        fontSize: '1.1rem',
        color: 'var(--foreground)',
        marginBottom: body ? '0.4rem' : '0.75rem',
        lineHeight: 1.3,
      }}>
        {title}
      </p>

      {body && (
        <p style={{
          fontSize: '0.83rem',
          color: 'var(--muted-fg)',
          lineHeight: 1.65,
          marginBottom: '0.75rem',
        }}>
          {body}
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
  )
}
