import { getTranslations } from 'next-intl/server'
import Image from 'next/image'
import Link from 'next/link'

export async function generateMetadata() {
  return {
    title: 'Frank — The Foolish Butcher',
    description: 'Custode del laboratorio. Guardiano delle discromie. Parla alle pelli.',
  }
}

// Video loop clips served from Cloudflare R2.
// Set NEXT_PUBLIC_FRANK_CDN=https://your-r2-public-url in Railway.
// If not set, the hero shows a static poster only.
const CDN = process.env.NEXT_PUBLIC_FRANK_CDN ?? ''
const HERO_VIDEO = CDN ? `${CDN}/scene_02_clip.mp4` : ''
const HERO_POSTER = '/frank/frank-02.png'

const OBSESSIONS = [
  {
    id: 'flock',
    label: 'IL FLOCK',
    quote: 'Ogni densità ha un carattere. Chi non lo sente non dovrebbe tatuare.',
    img: '/frank/frank-01.png',
  },
  {
    id: 'discromie',
    label: 'LE DISCROMIE',
    quote: 'Non sono difetti. Sono la firma. Chi le elimina non ha capito niente.',
    img: '/frank/frank-03.png',
  },
  {
    id: 'processo',
    label: 'IL PROCESSO',
    quote: 'La catalisi è meditazione. Chi la affretta merita quello che ottiene.',
    img: '/frank/frank-lab.png',
  },
]

export default async function FrankPage() {
  const t = await getTranslations('frank')

  return (
    <div style={{ backgroundColor: '#0a0806', color: '#e8dcc8' }}>

      {/* ── HERO ── */}
      <section className="relative h-screen flex items-end overflow-hidden">
        {/* Video / poster background */}
        {HERO_VIDEO ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            poster={HERO_POSTER}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'brightness(0.45) sepia(0.3)' }}
          >
            <source src={HERO_VIDEO} type="video/mp4" />
          </video>
        ) : (
          <Image
            src={HERO_POSTER}
            alt="Frank nel laboratorio"
            fill
            className="object-cover object-top"
            priority
            style={{ filter: 'brightness(0.4) sepia(0.3)' }}
          />
        )}

        {/* Gradient overlay — bottom fade */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent 30%, #0a0806 100%)' }}
        />

        {/* Title */}
        <div className="relative z-10 max-w-7xl mx-auto px-8 md:px-16 pb-16 w-full">
          <p
            className="text-xs font-bold tracking-[0.4em] uppercase mb-4"
            style={{ color: '#c9a96e' }}
          >
            {t('hero.eyebrow')}
          </p>
          <h1
            className="font-display leading-none mb-4"
            style={{ fontSize: 'clamp(72px, 14vw, 180px)', color: '#e8dcc8' }}
          >
            FRANK
          </h1>
          <p className="text-base max-w-md" style={{ color: '#a89880' }}>
            {t('hero.sub')}
          </p>
        </div>
      </section>

      {/* ── LORE ── */}
      <section className="max-w-3xl mx-auto px-8 md:px-16 py-24">
        <p
          className="text-xs font-bold tracking-[0.35em] uppercase mb-10"
          style={{ color: '#c9a96e' }}
        >
          {t('lore.eyebrow')}
        </p>

        <div className="space-y-6 text-base leading-relaxed" style={{ color: '#c8bfb0' }}>
          <p style={{ fontSize: '1.15rem', color: '#e8dcc8', fontWeight: 500 }}>
            {t('lore.line1')}
          </p>
          <p>{t('lore.line2')}</p>
          <p>{t('lore.line3')}</p>
          <p>{t('lore.line4')}</p>
          <p className="italic" style={{ color: '#a89880', borderLeft: '2px solid #c9a96e', paddingLeft: '1.25rem' }}>
            {t('lore.quote')}
          </p>
        </div>
      </section>

      {/* ── OSSESSIONI ── */}
      <section className="border-t py-24" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <p
            className="text-xs font-bold tracking-[0.35em] uppercase mb-12"
            style={{ color: '#c9a96e' }}
          >
            {t('obsessions.eyebrow')}
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {OBSESSIONS.map((o) => (
              <div key={o.id} className="group">
                <div className="relative aspect-[3/4] rounded overflow-hidden mb-5">
                  <Image
                    src={o.img}
                    alt={o.label}
                    fill
                    className="object-cover transition-transform duration-700 group-hover:scale-105"
                    style={{ filter: 'brightness(0.7) sepia(0.4)' }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(to top, #0a0806 0%, transparent 60%)' }}
                  />
                  <div className="absolute bottom-4 left-4 right-4">
                    <p
                      className="text-xs font-bold tracking-[0.3em] uppercase mb-1"
                      style={{ color: '#c9a96e' }}
                    >
                      {o.label}
                    </p>
                  </div>
                </div>
                <p className="text-sm italic leading-relaxed" style={{ color: '#a89880' }}>
                  &ldquo;{o.quote}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA — Parla con Frank ── */}
      <section
        className="border-t py-24"
        style={{ borderColor: '#1e1812' }}
      >
        <div className="max-w-7xl mx-auto px-8 md:px-16">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            {/* Image */}
            <div className="relative aspect-[4/5] rounded overflow-hidden order-2 md:order-1">
              <Image
                src="/frank/frank-lab.png"
                alt="Frank nel laboratorio"
                fill
                className="object-cover object-top"
                style={{ filter: 'brightness(0.65) sepia(0.35)' }}
              />
            </div>
            {/* Text */}
            <div className="order-1 md:order-2">
              <p
                className="text-xs font-bold tracking-[0.4em] uppercase mb-6"
                style={{ color: '#c9a96e' }}
              >
                {t('cta.eyebrow')}
              </p>
              <h2
                className="font-display leading-none mb-6"
                style={{ fontSize: 'clamp(40px, 6vw, 72px)', color: '#e8dcc8' }}
              >
                {t('cta.title')}
              </h2>
              <p className="text-base leading-relaxed mb-8" style={{ color: '#a89880' }}>
                {t('cta.body')}
              </p>
              <a
                href="https://t.me/the_foolish_butcher_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 px-8 py-4 font-semibold text-sm tracking-widest uppercase transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#c9a96e', color: '#0a0806' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.614c-.146.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.903.607z"/>
                </svg>
                {t('cta.button')}
              </a>

              <p className="text-xs mt-4" style={{ color: '#6b6055' }}>
                {t('cta.note')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Back link ── */}
      <div className="max-w-7xl mx-auto px-8 md:px-16 pb-16 border-t pt-8" style={{ borderColor: '#1e1812' }}>
        <Link href="/" className="text-xs tracking-widest uppercase hover:opacity-60 transition-opacity" style={{ color: '#6b6055' }}>
          ← {t('backToShop')}
        </Link>
      </div>

    </div>
  )
}
