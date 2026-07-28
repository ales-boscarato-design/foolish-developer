import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getTranslations, getLocale } from 'next-intl/server'
import { getProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import wallDataRaw from '@/data/sebo-wall.json'

interface WallEntry { id: string; image: string; line: string; date: string; platform_url?: string }
const wallData = wallDataRaw as WallEntry[]

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'sebo' })
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/sebo`]))
  return {
    title: 'Sebo — The Foolish Butcher',
    description: t('meta.description'),
    openGraph: {
      title: 'Sebo — The Foolish Butcher',
      description: t('meta.description'),
    },
    alternates: {
      canonical: `${BASE}/${locale}/sebo`,
      languages: { ...langs, 'x-default': `${BASE}/it/sebo` },
    },
  }
}

export default async function SeboPage() {
  const t = await getTranslations('sebo')
  const locale = await getLocale()
  const merchProducts = await getProducts('merch', locale)

  return (
    <div style={{ backgroundColor: '#0a0806', color: '#e8dcc8' }}>

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <Image
          src="/sebo/sebo-hero.png"
          alt="Sebo sul lettino"
          fill
          priority
          className="object-cover object-center"
          style={{ filter: 'brightness(0.55) sepia(0.15)' }}
        />
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent 40%, #0a0806 100%)' }}
        />
        <div className="relative z-10 text-center px-8 max-w-4xl mx-auto">
          <p className="text-xs font-bold tracking-[0.5em] uppercase mb-12" style={{ color: '#c9a96e' }}>
            THE FOOLISH BUTCHER · PRACTICE SKIN
          </p>
          <h1
            className="font-display leading-none whitespace-pre-line"
            style={{ fontSize: 'clamp(48px, 11vw, 144px)', color: '#e8dcc8', letterSpacing: '-0.02em' }}
          >
            {t('hero.manifesto')}
          </h1>
        </div>
      </section>

      {/* ── CHI È SEBO ── */}
      <section className="max-w-2xl mx-auto px-8 md:px-16 py-24">
        <p className="text-xs font-bold tracking-[0.35em] uppercase mb-10" style={{ color: '#c9a96e' }}>
          {t('bio.eyebrow')}
        </p>
        <div className="space-y-5" style={{ color: '#c8bfb0' }}>
          <p style={{ fontSize: '1.15rem', color: '#e8dcc8', fontWeight: 500, lineHeight: 1.6 }}>
            {t('bio.p1')}
          </p>
          <p style={{ fontSize: '1rem', lineHeight: 1.7 }}>{t('bio.p2')}</p>
          <p style={{ fontSize: '1rem', lineHeight: 1.7 }}>{t('bio.p3')}</p>
        </div>
      </section>

      {/* ── MERCH ── spostato in posizione 3 ── */}
      {merchProducts.length > 0 && (
        <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
          <div className="max-w-7xl mx-auto px-8 md:px-16">
            <p className="text-xs font-bold tracking-[0.35em] uppercase mb-6" style={{ color: '#c9a96e' }}>
              {t('merch.eyebrow')}
            </p>
            <h2
              className="font-display leading-none mb-4"
              style={{ fontSize: 'clamp(28px, 5vw, 64px)', color: '#e8dcc8', letterSpacing: '-0.02em' }}
            >
              {t('merch.headline')}
            </h2>
            <p className="mb-14 max-w-xl" style={{ fontSize: '0.95rem', color: '#6b6055', lineHeight: 1.7 }}>
              {t('merch.subline')}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {merchProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── IL MURO ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <p className="text-xs font-bold tracking-[0.35em] uppercase mb-12" style={{ color: '#c9a96e' }}>
            {t('wall.eyebrow')}
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {wallData.map((entry) => (
              <div key={entry.id} className="group relative">
                {entry.platform_url ? (
                  <a href={entry.platform_url} target="_blank" rel="noopener noreferrer" className="block">
                    <WallTile image={entry.image} line={entry.line} />
                  </a>
                ) : (
                  <WallTile image={entry.image} line={entry.line} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STICKERS ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">

            {/* Sticker image */}
            <div className="flex items-center justify-center">
              <div className="relative w-full max-w-sm mx-auto">
                <Image
                  src="/sebo/sticker1.png"
                  alt="Sticker N°001 — Non sono brutto, sono il tuo periodo di formazione"
                  width={600}
                  height={600}
                  className="w-full h-auto"
                  style={{ filter: 'drop-shadow(0 8px 32px rgba(201,169,110,0.15))' }}
                />
              </div>
            </div>

            {/* Copy */}
            <div>
              <p className="text-xs font-bold tracking-[0.35em] uppercase mb-6" style={{ color: '#c9a96e' }}>
                {t('stickers.eyebrow')}
              </p>
              <h2
                className="font-display leading-none mb-6"
                style={{ fontSize: 'clamp(28px, 4.5vw, 56px)', color: '#e8dcc8', letterSpacing: '-0.02em' }}
              >
                {t('stickers.headline')}
              </h2>
              <p className="mb-8" style={{ fontSize: '0.95rem', color: '#c8bfb0', lineHeight: 1.8 }}>
                {t('stickers.body')}
              </p>

              {/* Condition box */}
              <div
                className="border px-6 py-5 mb-6"
                style={{ borderColor: '#c9a96e' }}
              >
                <p className="text-xs font-bold tracking-[0.3em] uppercase mb-2" style={{ color: '#c9a96e' }}>
                  {t('stickers.conditionLabel')}
                </p>
                <p style={{ fontSize: '1.05rem', color: '#e8dcc8', fontWeight: 500, lineHeight: 1.6 }}>
                  {t('stickers.condition')}
                </p>
              </div>

              <p className="text-xs tracking-widest uppercase" style={{ color: '#555' }}>
                {t('stickers.date')}
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* ── LA PRATICA ── 2 ADV images ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <p className="text-xs font-bold tracking-[0.35em] uppercase mb-12" style={{ color: '#c9a96e' }}>
            {t('pratica.eyebrow')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
            <div className="relative aspect-[4/5] overflow-hidden">
              <Image
                src="/sebo/pratica-1.png"
                alt="Sebo sul lettino"
                fill
                className="object-cover"
                style={{ filter: 'brightness(0.85) sepia(0.1)' }}
              />
            </div>
            <div className="relative aspect-[4/5] overflow-hidden">
              <Image
                src="/sebo/pratica-2.png"
                alt="La pratica in corso"
                fill
                className="object-cover"
                style={{ filter: 'brightness(0.85) sepia(0.1)' }}
              />
            </div>
          </div>
          <p
            className="font-display leading-tight max-w-2xl"
            style={{ fontSize: 'clamp(20px, 3.5vw, 44px)', color: '#e8dcc8', letterSpacing: '-0.01em' }}
          >
            {t('pratica.quote')}
          </p>
        </div>
      </section>

      {/* ── IL MONDO DI SEBO ── 4 comprimari ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <p className="text-xs font-bold tracking-[0.35em] uppercase mb-12" style={{ color: '#c9a96e' }}>
            {t('mondo.eyebrow')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px" style={{ backgroundColor: '#1e1812' }}>
            {[
              {
                img: '/sebo/pellaio.png',
                nameKey: 'mondo.pellaio.name',
                lineKey: 'mondo.pellaio.line',
              },
              {
                img: '/sebo/arancia.png',
                nameKey: 'mondo.arancia.name',
                lineKey: 'mondo.arancia.line',
              },
              {
                img: '/sebo/corriere.png',
                nameKey: 'mondo.corriere.name',
                lineKey: 'mondo.corriere.line',
              },
              {
                img: '/sebo/scatola.png',
                nameKey: 'mondo.scatola.name',
                lineKey: 'mondo.scatola.line',
              },
            ].map(({ img, nameKey, lineKey }) => (
              <div key={nameKey} className="relative group overflow-hidden" style={{ backgroundColor: '#0a0806' }}>
                <div className="relative aspect-[4/3] overflow-hidden">
                  <Image
                    src={img}
                    alt={t(nameKey as any)}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    style={{ filter: 'brightness(0.7) sepia(0.15)' }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to top, rgba(10,8,6,0.95) 0%, rgba(10,8,6,0.2) 60%, transparent 100%)' }}
                  />
                </div>
                <div className="px-8 py-6">
                  <p className="text-xs font-bold tracking-[0.3em] uppercase mb-2" style={{ color: '#c9a96e' }}>
                    {t(nameKey as any)}
                  </p>
                  <p style={{ fontSize: '0.95rem', color: '#c8bfb0', lineHeight: 1.6 }}>
                    {t(lineKey as any)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── LA VITA SEGRETA ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="relative aspect-[4/5] overflow-hidden">
              <Image
                src="/sebo/vita-segreta.png"
                alt="Sebo allo specchio"
                fill
                className="object-cover"
                style={{ filter: 'brightness(0.9)' }}
              />
            </div>
            <div>
              <p className="text-xs font-bold tracking-[0.35em] uppercase mb-8" style={{ color: '#c9a96e' }}>
                {t('vitaSegreta.eyebrow')}
              </p>
              <p
                className="font-display leading-tight mb-6"
                style={{ fontSize: 'clamp(24px, 4vw, 52px)', color: '#e8dcc8', letterSpacing: '-0.02em' }}
              >
                {t('vitaSegreta.headline')}
              </p>
              <p style={{ fontSize: '0.95rem', color: '#6b6055', lineHeight: 1.8 }}>
                {t('vitaSegreta.body')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-3xl mx-auto px-8 md:px-16">
          <p className="text-xs font-bold tracking-[0.4em] uppercase mb-10" style={{ color: '#c9a96e' }}>
            {t('cta.eyebrow')}
          </p>

          <div className="mb-8">
            <a
              href="https://www.instagram.com/thefoolishbutcher_tattoo"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 font-semibold text-sm tracking-widest uppercase transition-opacity hover:opacity-80 mb-3"
              style={{ backgroundColor: '#c9a96e', color: '#0a0806' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
              </svg>
              {t('cta.instagram.button')}
            </a>
            <p className="text-xs" style={{ color: '#6b6055' }}>
              {t('cta.instagram.note')}
            </p>
          </div>

          <div className="mb-8">
            <a
              href="https://t.me/+f6VDb9iZdw5lMTE0"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 px-8 py-4 font-semibold text-sm tracking-widest uppercase border transition-opacity hover:opacity-70 mb-3"
              style={{ borderColor: '#c9a96e', color: '#c9a96e' }}
            >
              {t('cta.telegram.button')}
            </a>
            <p className="text-xs" style={{ color: '#6b6055' }}>
              {t('cta.telegram.note')}
            </p>
          </div>

          <div>
            <a
              href="https://t.me/the_foolish_butcher_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs tracking-widest uppercase hover:opacity-60 transition-opacity"
              style={{ color: '#444' }}
            >
              {t('cta.support.button')}
            </a>
            <p className="text-xs mt-1" style={{ color: '#444' }}>
              {t('cta.support.note')}
            </p>
          </div>
        </div>
      </section>

      {/* ── Il Pellaio cross-link ── */}
      <div className="max-w-7xl mx-auto px-8 md:px-16 py-12 border-t" style={{ borderColor: '#1e1812' }}>
        <p className="text-sm italic" style={{ color: '#555' }}>
          {t('pellaioLink')}{' '}
          <Link href="/laboratorio" className="underline hover:opacity-60 transition-opacity" style={{ color: '#6b6055' }}>
            /laboratorio
          </Link>
        </p>
      </div>

      <div className="max-w-7xl mx-auto px-8 md:px-16 pb-16">
        <Link href="/" className="text-xs tracking-widest uppercase hover:opacity-60 transition-opacity" style={{ color: '#6b6055' }}>
          {t('backToShop')}
        </Link>
      </div>

    </div>
  )
}

function WallTile({ image, line }: { image: string; line: string }) {
  return (
    <div className="relative aspect-square rounded overflow-hidden bg-[#111]">
      <Image
        src={image}
        alt={line}
        fill
        className="object-cover transition-transform duration-700 group-hover:scale-105"
        style={{ filter: 'brightness(0.8)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(10,8,6,0.9) 0%, transparent 50%)' }}
      />
      <p
        className="absolute bottom-3 left-3 right-3 text-xs leading-relaxed italic"
        style={{ color: '#c8bfb0' }}
      >
        {line}
      </p>
    </div>
  )
}
