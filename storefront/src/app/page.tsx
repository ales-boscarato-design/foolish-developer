export const dynamic = 'force-dynamic'

import Link from 'next/link'
import Image from 'next/image'
import { Truck, ShieldCheck, MessageSquare, Package, ArrowRight } from 'lucide-react'
import { getProducts, getLimitedProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { ManifestoPinned } from '@/components/ManifestoPinned'
import { SplitText } from '@/components/SplitText'

/* ─── Marquee cinetico — puro CSS, nessun JS ──────────────────────── */
function Marquee() {
  const items = [
    'FATTO A MANO',
    'CHIERI, TORINO',
    'DAL 2012',
    'OGNI PELLE IRRIPETIBILE',
    'IL COLORE CHE VEDI È QUELLO CHE HAI MESSO',
    'NON IMITA LA PELLE: LA INTERPRETA',
    'FATTA COME SERVE',
  ]
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
  align = 'left',
}: {
  eyebrow: string
  title: string
  copy: string
  href: string
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
        Vedi tutti <ArrowRight size={12} strokeWidth={2} />
      </Link>
    </div>
  )
}

/* ─── HOME PAGE ───────────────────────────────────────────────────── */
export default async function HomePage() {
  const [tattooProducts, pmuProducts, limitedProducts] = await Promise.all([
    getProducts('tattoo'),
    getProducts('pmu'),
    getLimitedProducts(),
  ])

  return (
    <div>

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
        <div className="flex flex-col justify-start md:justify-center px-8 md:px-16 lg:px-24 pt-8 pb-16 md:py-0 relative z-10">

          <p className="animate-fade-up text-xs tracking-[0.3em] uppercase mb-10" style={{ color: 'var(--muted-fg)' }}>
            Tattoo &amp; PMU Practice Skin — Made in Italy
          </p>

          <h1 className="font-display leading-none mb-8">
            <SplitText
              text="QUESTA"
              className="block text-[clamp(80px,13vw,160px)]"
              style={{ color: 'var(--foreground)' }}
              delay={0.15}
              stagger={0.06}
            />
            <SplitText
              text="È PELLE."
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
              Non è pubblicità.
            </p>
            <p className="text-base leading-relaxed" style={{ color: 'var(--muted-fg)' }}>
              È testata da chi la usa, non da chi la vende.<br />
              Non ti insegna a forzare: ti insegna a tatuare.<br />
              Il colore che vedi è quello che hai messo.
            </p>
          </div>

          <div className="animate-fade-up animate-fade-up-d3 flex flex-col sm:flex-row gap-3 mb-12">
            <Link
              href="/tattoo"
              className="px-8 py-4 font-semibold text-sm tracking-widest uppercase transition-all duration-200 active:scale-[0.98]"
              style={{ backgroundColor: 'var(--accent)', color: '#080808' }}
            >
              Entra nel negozio
            </Link>
            <Link
              href="/pmu"
              className="px-8 py-4 font-semibold text-sm tracking-widest uppercase border transition-colors duration-200 hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border)' }}
            >
              Scopri PMU
            </Link>
          </div>

          {/* Social proof strip */}
          <div className="animate-fade-up animate-fade-up-d4 flex gap-8">
            <div>
              <p className="stat-number text-3xl" style={{ color: 'var(--accent)' }}>5.0</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>Rating medio · 13 recensioni</p>
            </div>
            <div>
              <p className="stat-number text-3xl" style={{ color: 'var(--accent)' }}>2012</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>Anno di fondazione</p>
            </div>
            <div>
              <p className="stat-number text-3xl" style={{ color: 'var(--accent)' }}>0</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted-fg)' }}>Pelli identiche prodotte</p>
            </div>
          </div>
        </div>

        {/* Colonna destra — hero image */}
        <div
          className="hidden md:block relative border-l"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}
        >
          {/* Prodotto: object-contain (no crop), scale+translateY per "uscire" dal frame */}
          <Image
            src="/Hero/tattoo-practice-skin-foolish.png"
            alt="Foolish practice skin — foglio di pelle sintetica"
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
              <p
                className="font-display text-3xl leading-snug mb-4"
                style={{ color: 'var(--foreground)' }}
              >
                "NON IMITA<br />LA PELLE:<br />LA INTERPRETA."
              </p>
              <footer className="text-xs tracking-[0.2em] uppercase" style={{ color: 'var(--muted-fg)' }}>
                Alessandro · The Foolish Butcher
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
          title="Pagamenti criptati"
          body="Nessun dato salvato. Non tracciamo nessun dato sensibile."
        />
        <TrustBadge
          Icon={Truck}
          title="Spedizione tracciata"
          body="Veloce. Se c'è ritardo, ti mandiamo un foglio in più."
        />
        <TrustBadge
          Icon={MessageSquare}
          title="Supporto rapido"
          body="Scrivi. Un nanobot risponde subito — per le cose complesse ci siamo noi."
        />
        <TrustBadge
          Icon={Package}
          title="Free shipping"
          body="Italia da 55 € · Europa da 164 € · Mondo da 250 €"
        />
      </section>

      {/* ════════════════════════════════════════════════
          LIMITED STOCK
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
                  Stock limitato
                </p>
                <h2 className="font-display text-4xl leading-none">
                  COLORAZIONI RARE — DISPONIBILI ORA
                </h2>
              </div>
              <Link
                href="/limited"
                className="inline-flex items-center gap-2 text-xs tracking-widest uppercase shrink-0 hover:gap-3 transition-all duration-200"
                style={{ color: 'var(--accent)' }}
              >
                Vedi tutti <ArrowRight size={12} strokeWidth={2} />
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {limitedProducts.slice(0, 4).map((p) => (
                <ProductCard key={p.id} product={p} showLimitedBadge />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ════════════════════════════════════════════════
          SEZIONE TATTOO
      ════════════════════════════════════════════════ */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-20">
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-12 items-start">
            <div className="md:sticky md:top-24">
              <SectionLabel
                eyebrow="Sezione"
                title="TATTOO"
                copy="T-Sheet Skin DBL e DuoSkin. Due facce, zero compromessi. Ogni foglio prodotto a mano, nessuno uguale all'altro."
                href="/tattoo"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {tattooProducts.slice(0, 6).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
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
          SEZIONE PMU — layout speculare
      ════════════════════════════════════════════════ */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-20">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-12 items-start">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {pmuProducts.slice(0, 4).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            <div className="md:sticky md:top-24">
              <SectionLabel
                eyebrow="Sezione"
                title="PMU"
                copy="Kit viso, supporti e accessori per chi pratica Permanent Make-up sul serio."
                href="/pmu"
                align="right"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════
          CTA FINALE — Chiusura forte
      ════════════════════════════════════════════════ */}
      <section className="px-8 md:px-16 py-28 flex flex-col items-start max-w-7xl mx-auto">
        <p className="text-xs uppercase tracking-[0.3em] mb-6" style={{ color: 'var(--accent)' }}>
          Da noi in Italia, per te, ovunque.
        </p>
        <h2 className="font-display text-[clamp(38px,9vw,120px)] leading-none mb-10 max-w-3xl">
          <SplitText
            text="FATTA COME SERVE."
            className="block"
            stagger={0.04}
            whileInView
          />
          <SplitText
            text="CON CARATTERE."
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
          Entra nel negozio
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
