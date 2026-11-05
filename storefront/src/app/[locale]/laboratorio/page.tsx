import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { StaffBoard } from '@/components/laboratorio/StaffBoard'
import { PARADOX_IDS, TELEGRAM_BOT_URL, practiceSkinHref, type Translate } from '@/lib/laboratorio'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

/**
 * Slot per le immagini del nuovo Pellaio.
 *
 * Non esiste ancora nessun asset approvato del personaggio nuovo: lo slot resta vuoto, senza
 * segnaposto inventati e senza `alt` inventati. Quando arrivera' un'immagine approvata si
 * passera' qui `src` + `alt` e il resto della pagina non cambia.
 */
function ImageSlot({ slot }: { slot: string }) {
  return <div data-image-slot={slot} aria-hidden="true" hidden />
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'laboratorio' })
  const langs = Object.fromEntries(LOCALES.map((l) => [l, `${BASE}/${l}/laboratorio`]))
  return {
    title: 'Il Laboratorio — The Foolish Butcher',
    description: t('hero.sub'),
    openGraph: {
      title: 'Il Laboratorio — The Foolish Butcher',
      description: t('hero.sub'),
    },
    alternates: {
      canonical: `${BASE}/${locale}/laboratorio`,
      languages: { ...langs, 'x-default': `${BASE}/it/laboratorio` },
    },
  }
}

export default async function LaboratorioPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'laboratorio' })
  const tr: Translate = (key) => t(key)

  return (
    <div style={{ backgroundColor: '#0a0806', color: '#e8dcc8' }}>
      {/* ── 1. Hero tipografico (nessuna fotografia) ── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-20 sm:pt-32 pb-14 sm:pb-20">
        <ImageSlot slot="hero" />
        <p className="text-[11px] font-bold uppercase tracking-[0.4em] mb-6" style={{ color: '#c9a96e' }}>
          {t('hero.eyebrow')}
        </p>
        <h1
          className="font-display leading-[0.95] max-w-4xl"
          style={{ fontSize: 'clamp(38px, 8vw, 108px)', color: '#e8dcc8' }}
        >
          {t('hero.title')}
        </h1>
        <p className="mt-8 max-w-xl text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
          {t('hero.sub')}
        </p>
      </section>

      {/* ── 2. Chi è ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('intro.eyebrow')}
          </h2>
          <div className="max-w-2xl space-y-6 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
            <p className="text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
              {t('intro.p1')}
            </p>
            <p>{t('intro.p2')}</p>
            <p>{t('intro.p3')}</p>
            <p>{t('intro.p4')}</p>
          </div>
        </div>
      </section>

      {/* ── 3. La scala ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <ImageSlot slot="scale" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('scale.eyebrow')}
          </h2>
          <div className="max-w-2xl space-y-6 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
            <p className="text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
              {t('scale.p1')}
            </p>
            <p className="font-display text-2xl sm:text-3xl" style={{ color: '#c9a96e' }}>
              {t('scale.p2')}
            </p>
            <p>{t('scale.p3')}</p>
            <p>{t('scale.p4')}</p>
          </div>
        </div>
      </section>

      {/* ── 4. I sei reparti ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('staff.eyebrow')}
          </h2>
          <StaffBoard t={tr} label={t('staff.boardLabel')} intro={t('staff.intro')} />
        </div>
      </section>

      {/* ── 5. Il laboratorio ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <ImageSlot slot="lab" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('lab.eyebrow')}
          </h2>
          <div className="max-w-2xl space-y-6 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
            <p className="text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
              {t('lab.p1')}
            </p>
            <p>{t('lab.p2')}</p>
            <p>{t('lab.p3')}</p>
          </div>
        </div>
      </section>

      {/* ── 6. Il paradosso: le quattro verita' tecniche ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('paradox.eyebrow')}
          </h2>
          <div className="max-w-2xl space-y-6 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
            <p className="text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
              {t('paradox.intro')}
            </p>
            <div className="space-y-5 border-l pl-5" style={{ borderColor: '#3a2f22' }}>
              {PARADOX_IDS.map((id) => (
                <p key={id}>{t(`paradox.${id}`)}</p>
              ))}
            </div>
            <p className="font-display text-xl sm:text-2xl" style={{ color: '#e8dcc8' }}>
              {t('paradox.closing')}
            </p>
          </div>
        </div>
      </section>

      {/* ── 7. La serie ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('series.eyebrow')}
          </h2>
          <div className="max-w-2xl space-y-6 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
            <p className="text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
              {t('series.p1')}
            </p>
            <p>{t('series.p2')}</p>
          </div>

          <article className="mt-12 max-w-2xl border p-6 sm:p-8" style={{ borderColor: '#3a2f22' }}>
            <h3 className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: '#c9a96e' }}>
              {t('series.episode.code')} — {t('series.episode.title')}
            </h3>
            {t('series.episode.body') ? (
              <p className="mt-4 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
                {t('series.episode.body')}
              </p>
            ) : null}
          </article>
        </div>
      </section>

      {/* ── 8. CTA ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="font-display leading-none max-w-3xl" style={{ fontSize: 'clamp(30px, 5vw, 64px)', color: '#e8dcc8' }}>
            {t('cta.title')}
          </h2>
          <ul className="mt-10 flex flex-col sm:flex-row gap-3 sm:gap-4">
            <li>
              <Link
                href={practiceSkinHref(locale)}
                className="inline-flex items-center px-7 py-4 text-sm font-semibold uppercase tracking-widest transition-opacity hover:opacity-80"
                style={{ backgroundColor: '#c9a96e', color: '#0a0806' }}
              >
                {t('cta.practiceSkin')}
              </Link>
            </li>
            <li>
              <a
                href={TELEGRAM_BOT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-7 py-4 text-sm font-semibold uppercase tracking-widest border transition-opacity hover:opacity-70"
                style={{ borderColor: '#c9a96e', color: '#c9a96e' }}
              >
                {t('cta.bot')}
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* ── Ritorno alla vetrina ── */}
      <div className="max-w-6xl mx-auto px-5 sm:px-8 pb-16">
        <Link
          href={`/${locale}`}
          className="text-xs uppercase tracking-widest hover:opacity-60 transition-opacity"
          style={{ color: '#a89880' }}
        >
          {t('backToShop')}
        </Link>
      </div>
    </div>
  )
}
