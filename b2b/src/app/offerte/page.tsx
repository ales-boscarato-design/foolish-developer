import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { fetchActiveAnnouncement } from '@/lib/cms'

export const dynamic = 'force-dynamic'

export default async function OffertePage() {
  const t = await getTranslations('Offerte')
  const locale = await getLocale()
  const announcement = await fetchActiveAnnouncement()

  if (!announcement) {
    return (
      <div style={{ maxWidth: '640px' }}>
        <Link href="/catalogo" style={{
          fontSize: '0.78rem', color: 'var(--muted-fg)', textDecoration: 'none',
          display: 'inline-block', marginBottom: '2rem',
        }}>
          {t('tornaCatalogo')}
        </Link>
        <p style={{ color: 'var(--muted-fg)', fontSize: '0.9rem' }}>{t('nessunaOfferta')}</p>
      </div>
    )
  }

  const title =
    (locale === 'en' && announcement.titleEn) ||
    (locale === 'fr' && announcement.titleFr) ||
    (locale === 'es' && announcement.titleEs) ||
    (locale === 'de' && announcement.titleDe) ||
    announcement.title

  const content =
    (locale === 'en' && announcement.contentEn) ||
    (locale === 'fr' && announcement.contentFr) ||
    (locale === 'es' && announcement.contentEs) ||
    (locale === 'de' && announcement.contentDe) ||
    announcement.content || ''

  const body =
    (locale === 'en' && announcement.bodyEn) ||
    (locale === 'fr' && announcement.bodyFr) ||
    (locale === 'es' && announcement.bodyEs) ||
    (locale === 'de' && announcement.bodyDe) ||
    announcement.body || undefined

  const paragraphs = content.split(/\n\n+/).filter(Boolean)

  return (
    <div style={{ maxWidth: '640px' }}>
      <Link href="/catalogo" style={{
        fontSize: '0.78rem', color: 'var(--muted-fg)', textDecoration: 'none',
        display: 'inline-block', marginBottom: '2.5rem',
      }}>
        {t('tornaCatalogo')}
      </Link>

      <p style={{
        fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.18em',
        color: 'var(--accent)', marginBottom: '0.875rem',
      }}>
        ✦ {t('titolo')}
      </p>

      <h1 style={{
        fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
        fontSize: 'clamp(1.6rem, 4vw, 2.25rem)', lineHeight: 1.2,
        color: 'var(--foreground)', marginBottom: '2rem',
      }}>
        {title}
      </h1>

      {paragraphs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {paragraphs.map((para, i) => (
            <p key={i} style={{
              fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.8,
              whiteSpace: 'pre-line',
            }}>
              {para.trim()}
            </p>
          ))}
        </div>
      ) : body ? (
        <p style={{
          fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.8,
          whiteSpace: 'pre-line',
        }}>
          {body}
        </p>
      ) : null}
    </div>
  )
}
