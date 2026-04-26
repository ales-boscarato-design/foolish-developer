export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Truck, ShieldCheck, MessageSquare, Package, ArrowRight } from 'lucide-react'
import { getProducts, getLimitedProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

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
        className="grid grid-cols-1 md:grid-cols-[60%_40%] min-h-[100dvh] border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Colonna sinistra — testo */}
        <div className="flex flex-col justify-center px-8 md:px-16 lg:px-24 py-24 md:py-0">

          <p className="animate-fade-up text-xs tracking-[0.3em] uppercase mb-10" style={{ color: 'var(--muted-fg)' }}>
            Tattoo &amp; PMU Practice Skin — Made in Italy
          </p>

          <h1 className="animate-fade-up animate-fade-up-d1 font-display leading-none mb-8">
            <span
              className="block text-[clamp(80px,13vw,160px)]"
              style={{ color: 'var(--foreground)' }}
            >
              QUESTA
            </span>
            <span
              className="block text-[clamp(80px,13vw,160px)]"
              style={{ color: 'var(--accent)' }}
            >
              È PELLE.
            </span>
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

        {/* Colonna destra — pannello scuro */}
        <div
          className="hidden md:flex flex-col justify-between p-12 relative overflow-hidden border-l"
          style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }}
        >
          {/* Cerchio ink — decorazione geometrica */}
          <div
            className="absolute top-[-80px] right-[-80px] w-[380px] h-[380px] rounded-full border"
            style={{ borderColor: 'var(--border)', borderWidth: '40px' }}
          />
          <div
            className="absolute bottom-[20%] left-[-40px] w-[120px] h-[120px] rounded-full"
            style={{ backgroundColor: 'var(--accent)', opacity: 0.08 }}
          />

          {/* Badge "Se ritardiamo..." */}
          <div className="relative z-10 self-end">
            <div
              className="text-xs border px-4 py-2 tracking-wide"
              style={{ borderColor: 'var(--border)', color: 'var(--muted-fg)' }}
            >
              Se ritardiamo, ti ricompensiamo.
            </div>
          </div>

          {/* Quote manifesto in fondo */}
          <blockquote className="relative z-10">
            <p
              className="font-display text-3xl leading-snug mb-5"
              style={{ color: 'var(--foreground)' }}
            >
              "NON IMITA<br />LA PELLE:<br />LA INTERPRETA."
            </p>
            <footer className="text-xs tracking-[0.2em] uppercase" style={{ color: 'var(--muted-fg)' }}>
              Alessandro · The Foolish Butcher
            </footer>
          </blockquote>
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
          title="Supporto vero"
          body="Scrivi. Rispondiamo noi — non un bot. Anche di notte, spesso."
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
          MANIFESTO PRODUZIONE — Editorial full-width
      ════════════════════════════════════════════════ */}
      <section
        className="border-b px-8 md:px-16 py-24"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}
      >
        <div className="max-w-7xl mx-auto">
          {/* Headline */}
          <div className="mb-16">
            <p className="text-xs uppercase tracking-[0.3em] mb-6" style={{ color: 'var(--accent)' }}>
              Il processo
            </p>
            <h2 className="font-display text-[clamp(48px,8vw,100px)] leading-none tracking-tight max-w-4xl">
              OGNI PELLE È<br />
              <span style={{ color: 'var(--accent)' }}>UN PEZZO UNICO.</span>
            </h2>
          </div>

          {/* Grid: copy + stats */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_280px] gap-12 items-start border-t pt-12" style={{ borderColor: 'var(--border)' }}>
            <div>
              <p className="text-base leading-relaxed mb-4" style={{ color: 'var(--muted-fg)' }}>
                Foolish non compra la pelle, la fa. Dall'inizio. A mano. Da un silicone puro al platino,
                trasformato in superficie grazie a un processo proprietario che non troverai altrove.
              </p>
              <p className="text-base leading-relaxed" style={{ color: 'var(--muted-fg)' }}>
                Il colore? Non è stampato. È vivo.
              </p>
            </div>
            <div>
              <p className="text-base leading-relaxed" style={{ color: 'var(--muted-fg)' }}>
                Usiamo flock: microfili di nylon sospesi che durante la catalisi si fissano a profondità
                diverse. Nuance inaspettate, discromie reali, texture che cambiano a ogni prodotto.
                Esattamente come la pelle dei tuoi clienti.
              </p>
            </div>

            {/* Stats verticali */}
            <div className="border-l pl-10 space-y-8" style={{ borderColor: 'var(--border)' }}>
              <div>
                <p className="stat-number text-5xl mb-1" style={{ color: 'var(--accent)' }}>100%</p>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-fg)' }}>Produzione manuale</p>
              </div>
              <div>
                <p className="stat-number text-5xl mb-1" style={{ color: 'var(--accent)' }}>0</p>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-fg)' }}>Pelli identiche</p>
              </div>
              <div>
                <p className="stat-number text-5xl mb-1" style={{ color: 'var(--accent)' }}>IT</p>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--muted-fg)' }}>Chieri, Torino — Italia</p>
              </div>
            </div>
          </div>
        </div>
      </section>

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
        <h2 className="font-display text-[clamp(52px,9vw,120px)] leading-none mb-10 max-w-3xl">
          FATTA COME SERVE.<br />
          <span style={{ color: 'var(--accent)' }}>CON CARATTERE.</span>
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
