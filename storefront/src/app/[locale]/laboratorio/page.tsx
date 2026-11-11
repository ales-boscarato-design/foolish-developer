import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { TELEGRAM_BOT_URL, buildGiornataItems, figuraPerOra, practiceSkinHref } from '@/lib/laboratorio'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

/**
 * Slot per le immagini del nuovo Pellaio non ancora approvate.
 *
 * Lo slot dell'hero ha ricevuto la sua immagine (t_a27df990) e non ne ha piu' bisogno: resta
 * quello del laboratorio, vuoto, senza segnaposto inventati e senza `alt` inventati. Quando
 * arrivera' un'immagine approvata si passera' `src` + `alt` e il resto della pagina non cambia.
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
  const giornata = buildGiornataItems(t.raw('giornata.items'))

  return (
    <div style={{ backgroundColor: '#0a0806', color: '#e8dcc8' }}>
      {/* ── 1. Hero: immagine di testa e poi il testo, senza sovrapposizioni ── */}
      <section className="max-w-6xl mx-auto px-5 sm:px-8 pt-8 sm:pt-12 pb-14 sm:pb-20">
        {/*
          Immagine di testa approvata: un solo `<picture>` con due ritagli. Sotto i 640px entra il
          verticale (testa, monocolo e mano), altrimenti il paesaggio; la soglia e' la stessa del
          `min-[641px]` qui sotto, cosi' il rapporto riservato e' sempre quello del file scelto e
          il layout non salta mentre l'immagine decodifica. `width`/`height` sono le dimensioni
          intrinseche del file di fallback, come nel documento.
          Nessun testo sopra l'immagine: la composizione ha il Pellaio a sinistra-centro e
          l'insegna FOOLISH in alto a destra, e qualunque testo finirebbe addosso a uno dei due.
        */}
        <div className="mb-10 sm:mb-14 overflow-hidden border" style={{ borderColor: '#1e1812' }}>
          <picture>
            <source media="(max-width: 640px)" srcSet="/pellaio/hero-pellaio-mobile.webp" width={752} height={941} />
            {/* File statici gia' ridimensionati: `next/image` non serve qui, l'art direction vuole
                due ritagli diversi e le dimensioni intrinseche sono dichiarate a mano. */}
            <img
              src="/pellaio/hero-pellaio-desktop.webp"
              alt={t('hero.alt')}
              width={1600}
              height={900}
              sizes="100vw"
              loading="eager"
              fetchPriority="high"
              decoding="async"
              className="block w-full h-auto aspect-[752/941] min-[641px]:aspect-[1600/900]"
            />
          </picture>
        </div>
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

      {/* ── 2. Chi è (assorbe la scala) ── */}
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
          </div>
        </div>
      </section>

      {/* ── 3. Una giornata: sette voci orarie, dalla struttura dati ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('giornata.eyebrow')}
          </h2>
          <p className="max-w-2xl text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
            {t('giornata.intro')}
          </p>
          <ol className="mt-10 max-w-2xl">
            {giornata.map((voce) => {
              // La figura del ruolo e' la stessa in tutte le lingue: cambiano solo ruolo e alt.
              const figura = figuraPerOra(voce.ora)
              return (
                <li key={voce.ora} className="py-5 border-t first:border-t-0 first:pt-0 last:pb-0" style={{ borderColor: '#1e1812' }}>
                  {/*
                    Altezza normalizzata (le larghezze dei ritagli sono diverse), larghezza automatica:
                    cosi' le figure non si deformano e i piedi restano sulla stessa linea, allineati al
                    fondo della riga. Niente oggetto-cover: `next/image` qui non ritaglia nulla. Le
                    dimensioni intrinseche in `width`/`height` riservano lo spazio prima del caricamento.
                  */}
                  <div className="flex items-end gap-4 sm:gap-8">
                    {figura ? (
                      <Image
                        src={figura.src}
                        alt={voce.alt}
                        width={figura.width}
                        height={figura.height}
                        loading="lazy"
                        decoding="async"
                        className="h-[112px] w-auto shrink-0 sm:h-[168px]"
                      />
                    ) : null}
                    {/* Su mobile l'orario sta su una riga sua: a 375px nessuna colonna da comprimere. */}
                    <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-8">
                      <span
                        className="shrink-0 font-display text-lg sm:text-xl tabular-nums"
                        style={{ color: '#c9a96e' }}
                      >
                        {voce.ora}
                      </span>
                      <p className="min-w-0 text-base sm:text-lg leading-relaxed break-words" style={{ color: '#b9ab94' }}>
                        {voce.ruolo ? (
                          <span className="font-semibold" style={{ color: '#e8dcc8' }}>
                            {voce.ruolo}.{' '}
                          </span>
                        ) : null}
                        {voce.testo}
                      </p>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      </section>

      {/* ── 4. Il laboratorio ── */}
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

      {/* ── 5. Il paradosso: le verità tecniche ── */}
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
              <p>{t('paradox.p1')}</p>
              <p>{t('paradox.p2')}</p>
            </div>
            <p className="font-display text-xl sm:text-2xl" style={{ color: '#e8dcc8' }}>
              {t('paradox.closing')}
            </p>
          </div>
        </div>
      </section>

      {/* ── 6. Cosa c'entra con te ── */}
      <section className="border-t" style={{ borderColor: '#1e1812' }}>
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-16 sm:py-24">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.4em] mb-10" style={{ color: '#c9a96e' }}>
            {t('ponte.eyebrow')}
          </h2>
          <div className="max-w-2xl space-y-6 text-base sm:text-lg leading-relaxed" style={{ color: '#b9ab94' }}>
            <p className="text-xl sm:text-2xl leading-snug" style={{ color: '#e8dcc8' }}>
              {t('ponte.p1')}
            </p>
            <p>{t('ponte.p2')}</p>
          </div>
        </div>
      </section>

      {/* ── 7. CTA ── */}
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
