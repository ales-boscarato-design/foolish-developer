import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { fetchActiveAnnouncement } from '@/lib/cms'

export const dynamic = 'force-dynamic'

export default async function OffertePage() {
  const t = await getTranslations('Offerte')
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

  const paragraphs = (announcement.content ?? '').split(/\n\n+/).filter(Boolean)

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
        {announcement.title}
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
      ) : announcement.body ? (
        <p style={{
          fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.8,
          whiteSpace: 'pre-line',
        }}>
          {announcement.body}
        </p>
      ) : null}
    </div>
  )
}
