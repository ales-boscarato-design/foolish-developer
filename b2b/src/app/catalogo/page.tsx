import { Suspense } from 'react'
import { fetchResellerProducts, fetchActiveAnnouncement } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { KitCard } from '@/components/KitCard'
import { AnnouncementBanner } from '@/components/AnnouncementBanner'
import { LoginTracker } from '@/components/LoginTracker'
import { getTranslations, getLocale } from 'next-intl/server'
import { getServerSession } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function CatalogoPage() {
  const locale = await getLocale()
  const products = await fetchResellerProducts(locale)
  const t = await getTranslations('Catalogo')
  const announcement = await fetchActiveAnnouncement()
  const session = await getServerSession()

  return (
    <div>
      <Suspense>
        <LoginTracker email={session?.email ?? ''} />
      </Suspense>
      {announcement && <AnnouncementBanner announcement={announcement} />}
      {/* ── HERO ── */}
      <section style={{ marginBottom: '4rem', paddingBottom: '3rem', borderBottom: '1px solid var(--border)' }}>
        <p style={{
          fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.18em',
          color: 'var(--accent)', marginBottom: '1rem',
        }}>
          {t('portaleRivenditori')}
        </p>
        <h1 style={{
          fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
          fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 1.1,
          color: 'var(--foreground)', marginBottom: '1.5rem', maxWidth: '28rem',
        }}>
          {t('heroTitle')}
        </h1>
        <p style={{
          fontSize: '0.9rem', color: 'var(--muted-fg)', lineHeight: 1.75,
          maxWidth: '38rem', marginBottom: '2.5rem',
        }}>
          {t('heroBody')}{' '}
          <em style={{ color: 'var(--foreground)', fontStyle: 'italic' }}>{t('habitueSuffix')}</em>.
        </p>

        {/* Pillar cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1px',
          background: 'var(--border)',
          border: '1px solid var(--border)',
          borderRadius: '1rem',
          overflow: 'hidden',
        }}>
          {(['p1', 'p2', 'p3'] as const).map((key) => (
            <div key={key} style={{ background: 'var(--card)', padding: '1.75rem 1.5rem' }}>
              <span aria-hidden="true" style={{ fontSize: '1.1rem', color: 'var(--accent)', display: 'block', marginBottom: '0.875rem' }}>
                {t(`pillars.${key}icon`)}
              </span>
              <p style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--foreground)', marginBottom: '0.5rem' }}>
                {t(`pillars.${key}title`)}
              </p>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', lineHeight: 1.65 }}>
                {t(`pillars.${key}body`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CATALOGO ── */}
      {products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--muted-fg)' }}>
          <p>{t('nessuniProdotti')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
          {(
            [
              { key: 'tattoo', label: 'Tattoo', descKey: 'tattooDesc' },
              { key: 'pmu', label: 'PMU', descKey: 'pmuDesc' },
            ] as const
          ).map(({ key, label, descKey }) => {
            const section = products.filter(p => p.section === key)
            if (section.length === 0) return null
            return (
              <section key={key}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '0.5rem' }}>
                  <h2 style={{
                    fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
                    fontSize: '1.75rem', color: 'var(--foreground)',
                  }}>
                    {label}
                  </h2>
                  <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--accent)' }}>
                    {section.length === 1 ? `1 ${t('prodotto')}` : `${section.length} ${t('prodotti')}`}
                  </span>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem' }}>
                  {t(descKey)}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1.25rem' }}>
                  {section.map(p => <ProductCard key={p.id} product={p} />)}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* ── KIT RIVENDITORI ── */}
      {(() => {
        const kits = products.filter(p => p.section === 'kit')
        if (kits.length === 0) return null
        return (
          <section style={{ marginTop: '4rem', paddingTop: '3rem', borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', marginBottom: '0.5rem' }}>
              <h2 style={{
                fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600,
                fontSize: '1.75rem', color: 'var(--foreground)',
              }}>
                {t('kitTitle')}
              </h2>
              <span style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--accent)' }}>
                {t('kitBadge')}
              </span>
            </div>
            <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.75rem' }}>
              {t('kitDesc')}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
              {kits.map((kit, i) => <KitCard key={kit.id} product={kit} featured={i === 1} />)}
            </div>
          </section>
        )
      })()}

      {/* ── INFO RIVENDITORI ── */}
      <section style={{ marginTop: '5rem', paddingTop: '3.5rem', borderTop: '1px solid var(--border)' }}>
        <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.18em', color: 'var(--accent)', marginBottom: '2.5rem' }}>
          {t('infoTitle')}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
          <div>
            <h3 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--foreground)', marginBottom: '1rem' }}>
              {t('info1Title')}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8 }}>{t('info1Body1')}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8, marginTop: '0.875rem' }}>
              {t('info1Body2')}{' '}
              <span style={{ color: 'var(--foreground)', fontWeight: 500 }}>{t('info1Days')}</span>
              {t('info1Body3')}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8, marginTop: '0.875rem' }}>{t('info1Body4')}</p>
          </div>
          <div>
            <h3 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--foreground)', marginBottom: '1rem' }}>
              {t('info2Title')}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8 }}>{t('info2Body')}</p>
          </div>
          <div>
            <h3 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '1.25rem', color: 'var(--foreground)', marginBottom: '1rem' }}>
              {t('info3Title')}
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8 }}>{t('info3Body1')}</p>
            <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)', lineHeight: 1.8, marginTop: '0.875rem' }}>{t('info3Body2')}</p>
          </div>
        </div>
      </section>
    </div>
  )
}
