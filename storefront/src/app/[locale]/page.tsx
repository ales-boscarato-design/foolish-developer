export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { getTranslations, getLocale } from 'next-intl/server'
import Link from 'next/link'
import Image from 'next/image'
import { Truck, ShieldCheck, MessageSquare, Package, ArrowRight } from 'lucide-react'
import { getProducts, getLimitedProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { ManifestoPinned } from '@/components/ManifestoPinned'
import { SplitText } from '@/components/SplitText'
import { BentoGrid, BentoItem } from '@/components/BentoGrid'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}`]))
  return {
    title: 'The Foolish Butcher — Pelle sintetica artigianale per tattoo e PMU',
    alternates: {
      canonical: `${BASE}/${locale}`,
      languages: { ...langs, 'x-default': `${BASE}/it` },
    },
    openGraph: {
      url: `${BASE}/${locale}`,
      images: [{ url: '/og/home.jpg', width: 1200, height: 630, alt: 'The Foolish Butcher' }],
    },
  }
}

const orgSchema = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'The Foolish Butcher',
  url: BASE,
  logo: `${BASE}/logo.png`,
  sameAs: ['https://www.instagram.com/thefoolishbutcher'],
  description:
    'Artigiano italiano specializzato in pelle sintetica per la pratica del tattoo e PMU. Ogni foglio è fatto a mano.',
}

/* ─── Marquee cinetico — puro CSS, nessun JS ──────────────────────── */
async function Marquee() {
  const t = await getTranslations('home')
  const items = t.raw('marquee.items') as string[]
  const text = items.join('  ·  ') + '  ·  '

  return (
    <div
      className="border-y overflow-hidden py-3.5 select-none"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}
      aria-hidden
    >
      <div className="marquee-track">
        {[text, text].map((t, i) => (
          <span
            key={i}
            className="font-display text-sm tracking-[0.15em] whitespace-nowrap pr-0"
            style={{ color: 'var(--accent)' }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  )
}

/* ─── Trust badge ─────────────────────────────────────────────────── */
function TrustBadge({
  Icon,
  title,
  body,
}: {
  Icon: React.ElementType
  title: string
  body: string
}) {
  return (
    <div className="px-7 py-8 flex gap-4 items-start" style={{ borderColor: 'var(--border)' }}>
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
      <div>
        <p className="text-xs font-semibold tracking-wide uppercase mb-1">{title}</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{body}</p>
      </div>
    </div>
  )
}

/* ─── Sezione label + griglia ─────────────────────────────────────── */
function SectionLabel({
  eyebrow,
  title,
  copy,
  href,
  cta,
  align = 'left',
}: {
  eyebrow: string
  title: string
  copy: string
  href: string
  cta: string
  align?: 'left' | 'right'
}) {
  return (
    <div className={align === 'right' ? 'md:text-right' : ''}>
      <p className="text-xs uppercase tracking-[0.25em] mb-3" style={{ color: 'var(--muted-fg)' }}>
        {eyebrow}
      </p>
      <h2 className="font-display text-6xl md:text-7xl leading-none mb-5">{title}</h2>
      <span className="ink-line mb-5 block" style={{ marginLeft: align === 'right' ? 'auto' : undefined }} />
      <p className="text-sm leading-relaxed mb-6 max-w-xs" style={{ color: 'var(--muted-fg)', marginLeft: align === 'right' ? 'auto' : undefined }}>
        {copy}
      </p>
      <Link
        href={href}
        className="inline-flex items-center gap-2 text-xs tracking-widest uppercase hover:gap-3 transition-all duration-200"
        style={{ color: 'var(--accent)' }}
      >
        {cta} <ArrowRight size={12} strokeWidth={2} />
      </Link>
    </div>
  )
}

/* ─── HOME PAGE ───────────────────────────────────────────────────── */
export default async function HomePage() {
  const t = await getTranslations('home')
  const locale = await getLocale()
  const [tattooProducts, pmuProducts, limitedProducts] = await Promise.all([
    getProducts('tattoo', locale),
    getProducts('pmu', locale),
    getLimitedProducts(locale),
  ])

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />

      {/* ════════════════════════════════════════════════
          HERO — Split asimmetrico, headline Bebas Neue
      ════════════════════════════════════════════════ */}
      <section
        className="grid grid-cols-1 md:grid-cols-[60%_40%] min-h-[100dvh] border-b relative"
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Mobile hero image — visibile solo su mobile, a destra con scrim sinistra */}
        <div className="md:hidden absolute inset-0 pointer-events-none" aria-hidden>
          <Image
            src="/Hero/tattoo-practice-skin-foolish.png"
            alt=""
            fill
            sizes="100vw"
            className="object-contain"
            style={{
              objectPosition: 'right center',
              transform: 'scale(1.08) translateX(8%)',
              transformOrigin: 'right center',
              filter: 'drop-shadow(-10px 10px 30px rgba(0,0,0,0.9))',
              opacity: 0.72,
            }}
            priority
          />
          {/* Scrim: testo a sinistra leggibile, prodotto visibile a destra */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, var(--background) 15%, rgba(8,8,8,0.75) 40%, transparent 80%)',
            }}
          />
        </div>

        {/* Colonna sinistra — testo */}
        <div className="flex flex-col justify-start px-8 md:px-16 lg:px-24 pt-8 md:pt-14 pb-16 md:pb-20 relative z-10">

          <p
            className="animate-fade-up text-xs tracking-[0.3em] uppercase mb-10"
            style={{
              color: 'rgba(240, 237, 232, 0.55)',
              textShadow: '0 1px 8px rgba(0,0,0,0.9)',
            }}
          >
            {t('hero.subtitle')}
          </p>

          <h1 className="font-display leading-none mb-8">
            <SplitText
              text={t('hero.headline1')}
              className="block text-[clamp(80px,13vw,160px)]"
              style={{ color: 'var(--foreground)' }}
              delay={0.15}
              stagger={0.06}
            />
            <SplitText
              text={t('hero.headline2')}
              className="block text-[clamp(80px,13vw,160px)]"
              style={{ color: 'var(--accent)' }}
              delay={0.55}
              stagger={0.06}
            />
          </h1>

          <div
            className="animate-fade-up animate-fade-up-d2 border-l-2 pl-5 mb-10 space-y-3"
            style={{ borderColor: 'var(--accent)' }}
          >
            <p className="text-lg leading-snug font-medium">
              {t('hero.notAdLabel')}
            </p>
            <p
              className="text-base leading-relaxed"
              style={{
                color: 'rgba(240, 237, 232, 0.7)',
                textShadow: '0 1px 10px rgba(0,0,0,0.95)',
              }}
            >
              {t('hero.notAdLine1')}<br />
              {t('hero.notAdLine2')}<br />
              {t('hero.notAdLine3')}
            </p>
          </div>

          <div className="animate-fade-up animate-fade-up-d3 flex flex-col sm:flex-row gap-3 mb-12">
            <Link
              href="/tattoo"
              className="px-8 py-4 font-semibold text-sm tracking-widest uppercase transition-all duration-200 active:scale-[0.98]"
              style={{ backgroundColor: 'var(--accent)', color: '#080808' }}
            >
              {t('hero.ctaShop')}
            </Link>
            <Link
              href="/pmu"
              className="px-8 py-4 font-semibold text-sm tracking-widest uppercase border transition-colors duration-200 hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border)' }}
            >
              {t('hero.ctaPmu')}
            </Link>
          </div>

          {/* Social proof strip */}
          <div className="animate-fade-up animate-fade-up-d4 flex gap-8">
            <div>
              <p className="stat-number text-3xl" style={{ color: 'var(--accent)' }}>5.0</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>{t('hero.statsRating')}</p>
            </div>
            <div>
              <p className="stat-number text-3xl" style={{ color: 'var(--accent)' }}>2012</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>{t('hero.statsFounded')}</p>
            </div>
            <div>
              <p className="stat-number text-3xl" style={{ color: 'var(--accent)' }}>0</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>{t('hero.statsProduced')}</p>
            </div>
          </div>
        </div>

        {/* Colonna destra — hero image */}
        <div
          className="hidden md:block relative border-l"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--background)' }}
        >
          {/* Prodotto: object-contain (no crop), scale+translateY per "uscire" dal frame */}
          <Image
            src="/Hero/tattoo-practice-skin-foolish.png"
            alt={t('hero.imageAlt')}
            fill
            sizes="44vw"
            className="object-contain"
            style={{
              objectPosition: 'center 48%',
              filter: 'drop-shadow(-18px 28px 48px rgba(0,0,0,0.85))',
              transform: 'scale(1.16) translateY(-5%)',
              transformOrigin: 'center center',
            }}
            priority
          />

          {/* Scrim solo in basso — leggibilità blockquote */}
          <div
            className="absolute inset-x-0 bottom-0 h-[45%] z-[1]"
            style={{
              background:
                'linear-gradient(to top, rgba(8,8,8,0.88) 0%, rgba(8,8,8,0.5) 50%, transparent 100%)',
            }}
          />

          {/* Quote manifesto — non troppo in basso */}
          <div className="absolute bottom-[20%] left-12 right-8 z-10">
            <blockquote>
              <div
                className="font-display text-3xl leading-snug mb-4"
                style={{ color: 'var(--foreground)' }}
                dangerouslySetInnerHTML={{ __html: `&ldquo;${t('hero.quote').split('\n').join('<br/>')}&rdquo;` }}
              />
              <footer className="text-xs tracking-[0.2em] uppercase" style={{ color: 'var(--muted-fg)' }}>
                {t('hero.quoteAuthor')}
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          MARQUEE cinetico
      ════════════════════════════════════════════════ */}
      <Marquee />

      {/* ════════════════════════════════════════════════
          TRUST STRIP — no card, divide-x
      ════════════════════════════════════════════════ */}
      <section
        className="border-b grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 md:divide-x"
        style={{ borderColor: 'var(--border)' }}
      >
        <TrustBadge
          Icon={ShieldCheck}
          title={t('badges.payments.title')}
          body={t('badges.payments.body')}
        />
        <TrustBadge
          Icon={Truck}
          title={t('badges.shippingSpeed.title')}
          body={t('badges.shippingSpeed.body')}
        />
        <TrustBadge
          Icon={MessageSquare}
          title={t('badges.support.title')}
          body={t('badges.support.body')}
        />
        <TrustBadge
          Icon={Package}
          title={t('badges.freeShipping.title')}
          body={t('badges.freeShipping.body')}
        />
      </section>

{/* ════════════════════════════════════════════════
          LIMITED STOCK — Bento grid asymmetrico
       ════════════════════════════════════════════════ */}
      {limitedProducts.length > 0 && (
        <section
          className="border-b px-8 md:px-16 py-14"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}
        >
          <div className="max-w-7xl mx-auto">
            <div className="flex items-end justify-between mb-8">
              <div>
                <p
                  className="text-xs font-bold tracking-[0.25em] uppercase mb-2"
                  style={{ color: 'var(--limited)' }}
                >
                  {t('limited.badge')}
                </p>
                <h2 className="font-display text-4xl leading-none">
                  {t('limited.headline')}
                </h2>
              </div>
              <Link
                href="/limited"
                className="inline-flex items-center gap-2 text-xs tracking-widest uppercase shrink-0 hover:gap-3 transition-all duration-200"
                style={{ color: 'var(--accent)' }}
              >
                {t('limited.cta')} <ArrowRight size={12} strokeWidth={2} />
              </Link>
            </div>
            <BentoGrid className="grid-cols-2 md:grid-cols-4">
              {limitedProducts[0] && (
                <BentoItem span="col-2-row-2" delay={0}>
                  <ProductCard product={limitedProducts[0]} showLimitedBadge className="h-full min-h-[280px] md:min-h-[400px]" />
                </BentoItem>
              )}
              {limitedProducts.slice(1, 4).map((p, i) => (
                <BentoItem key={p.id} delay={(i + 1) * 0.08}>
                  <ProductCard product={p} showLimitedBadge />
                </BentoItem>
              ))}
            </BentoGrid>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          SEZIONE TATTOO — Bento asymmetric grid
       ════════════════════════════════════════════════ */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-20">
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-12 items-start">
            <div className="md:sticky md:top-24">
              <SectionLabel
                eyebrow={t('sections.label')}
                title={t('cards.tattoo.title')}
                copy={t('cards.tattoo.copy')}
                href="/tattoo"
                cta={t('seeAll')}
              />
            </div>
            <BentoGrid className="grid-cols-2 md:grid-cols-3">
              <BentoItem span="col-2-row-2" delay={0}>
                {tattooProducts[0] && <ProductCard product={tattooProducts[0]} className="h-full min-h-[360px] md:min-h-[480px]" />}
              </BentoItem>
              {tattooProducts.slice(1, 3).map((p, i) => (
                <BentoItem key={p.id} delay={i * 0.08}>
                  <ProductCard product={p} />
                </BentoItem>
              ))}
              {tattooProducts.slice(3, 6).map((p, i) => (
                <BentoItem key={p.id} delay={(i + 2) * 0.06}>
                  <ProductCard product={p} />
                </BentoItem>
              ))}
            </BentoGrid>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          MANIFESTO PRODUZIONE — Sticky scroll-driven storytelling
      ════════════════════════════════════════════════ */}
      <ManifestoPinned visuals={{
  unique: '/manifesto/unique.png',
  crafted: '/manifesto/crafted.png',
  flock: '/manifesto/flock.png',
}} />


{/* ════════════════════════════════════════════════
          SEZIONE PMU — Bento speculare, label a destra
       ════════════════════════════════════════════════ */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-20">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-12 items-start">
            <BentoGrid className="grid-cols-2 md:grid-cols-4">
              {pmuProducts.slice(0, 4).map((p, i) => (
                <BentoItem key={p.id} delay={i * 0.07}>
                  <ProductCard product={p} />
                </BentoItem>
              ))}
            </BentoGrid>
            <div className="md:sticky md:top-24">
              <SectionLabel
                eyebrow={t('sections.label')}
                title={t('cards.pmu.title')}
                copy={t('cards.pmu.copy')}
                href="/pmu"
                cta={t('seeAll')}
                align="right"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          FOOLISH PRO — Banner B2B
      ════════════════════════════════════════════════ */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-10">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--accent)' }}>
                {t('pro.badge')}
              </span>
              <p className="text-base font-semibold mt-1">{t('pro.bannerTitle')}</p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--muted-fg)' }}>{t('pro.bannerBody')}</p>
            </div>
            <a
              href="/pro"
              className="flex-shrink-0 px-5 py-2.5 rounded font-semibold text-sm border transition-opacity hover:opacity-80"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
            >
              {t('pro.bannerCta')}
            </a>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          FRANK — Teaser atmosferico
      ════════════════════════════════════════════════ */}
      <section className="border-b" style={{ borderColor: 'var(--border)', backgroundColor: '#0a0806' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-16 grid md:grid-cols-[1fr_340px] gap-10 items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.4em] uppercase mb-4" style={{ color: '#c9a96e' }}>
              {t('frank.eyebrow')}
            </p>
            <h2 className="font-display text-5xl md:text-6xl leading-none mb-5" style={{ color: '#e8dcc8' }}>
              {t('frank.headline')}
            </h2>
            <p className="text-sm leading-relaxed mb-8 max-w-sm" style={{ color: '#a89880' }}>
              {t('frank.body')}
            </p>
            <a
              href="/frank"
              className="inline-flex items-center gap-2 text-sm font-semibold tracking-widest uppercase transition-opacity hover:opacity-70"
              style={{ color: '#c9a96e' }}
            >
              {t('frank.cta_short')} →
            </a>
          </div>
          <div className="relative aspect-[3/4] rounded overflow-hidden hidden md:block">
            <img
              src="/frank/frank-03.png"
              alt="Frank nel laboratorio"
              className="w-full h-full object-cover object-top"
              style={{ filter: 'brightness(0.75) sepia(0.3)' }}
            />
            <div
              className="absolute inset-0"
              style={{ background: 'linear-gradient(to bottom, transparent 60%, #0a0806 100%)' }}
            />
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          CTA FINALE — Chiusura forte
      ════════════════════════════════════════════════ */}
      <section className="px-8 md:px-16 py-28 flex flex-col items-start max-w-7xl mx-auto">
        <p className="text-xs uppercase tracking-[0.3em] mb-6" style={{ color: 'var(--accent)' }}>
          {t('finale.subtitle')}
        </p>
        <h2 className="font-display text-[clamp(38px,9vw,120px)] leading-none mb-10 whitespace-nowrap">
          <SplitText
            text={t('finale.headline1')}
            className="block"
            stagger={0.04}
            whileInView
          />
          <SplitText
            text={t('finale.headline2')}
            className="block"
            style={{ color: 'var(--accent)' }}
            stagger={0.04}
            delay={0.25}
            whileInView
          />
        </h2>
        <Link
          href="/tattoo"
          className="inline-flex items-center gap-3 px-10 py-4 font-semibold text-sm tracking-widest uppercase transition-all duration-200 active:scale-[0.98] group"
          style={{ backgroundColor: 'var(--accent)', color: '#080808' }}
        >
          {t('finale.cta')}
          <ArrowRight
            size={14}
            strokeWidth={2.5}
            className="group-hover:translate-x-1 transition-transform duration-200"
          />
        </Link>
      </section>

    </div>
  )
}
