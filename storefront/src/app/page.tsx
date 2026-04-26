export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { Truck, ShieldCheck, MessageSquare, Package } from 'lucide-react'
import { getProducts, getLimitedProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export default async function HomePage() {
  const [tattooProducts, pmuProducts, limitedProducts] = await Promise.all([
    getProducts('tattoo'),
    getProducts('pmu'),
    getLimitedProducts(),
  ])

  return (
    <div>

      {/* ── HERO ── Asimmetrico: sinistra testo / destra pannello ── */}
      <section
        className="grid grid-cols-1 md:grid-cols-[58%_42%] min-h-[100dvh] border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        {/* Colonna sinistra — testo */}
        <div className="flex flex-col justify-center px-8 md:px-16 py-20 md:py-0">
          <p className="animate-fade-up text-xs tracking-[0.25em] uppercase mb-10" style={{ color: 'var(--accent)' }}>
            Fatto a mano · Chieri, Italia · Dal 2012
          </p>

          <h1
            className="animate-fade-up animate-fade-up-delay-1 text-6xl md:text-8xl font-bold tracking-tighter leading-none mb-8"
            style={{ color: 'var(--foreground)' }}
          >
            Questa<br />
            <span style={{ color: 'var(--accent)' }}>è pelle.</span>
          </h1>

          <div className="animate-fade-up animate-fade-up-delay-2 max-w-md space-y-3 mb-12" style={{ color: 'var(--muted-fg)' }}>
            <p className="text-lg leading-relaxed">
              Non è pubblicità. È testata da chi la usa, non da chi la vende.
            </p>
            <p className="text-base leading-relaxed">
              Non ti insegna a forzare: ti insegna a tatuare.<br />
              Il colore che vedi è quello che hai messo.
            </p>
          </div>

          <div className="animate-fade-up animate-fade-up-delay-3 flex flex-col sm:flex-row gap-3">
            <Link
              href="/tattoo"
              className="px-7 py-3.5 font-semibold text-sm tracking-wide transition-all duration-200 active:scale-[0.98]"
              style={{ backgroundColor: 'var(--accent)', color: '#0a0a0a' }}
            >
              Entra nel negozio
            </Link>
            <Link
              href="/pmu"
              className="px-7 py-3.5 font-semibold text-sm tracking-wide border transition-colors duration-200 hover:border-[var(--accent)]"
              style={{ borderColor: 'var(--border)' }}
            >
              Permanent Make-up
            </Link>
          </div>

          <p
            className="animate-fade-up animate-fade-up-delay-4 mt-10 text-xs tracking-wide"
            style={{ color: 'var(--muted-fg)' }}
          >
            Se ritardiamo, ti ricompensiamo.
          </p>
        </div>

        {/* Colonna destra — pannello visivo */}
        <div
          className="hidden md:flex flex-col justify-end p-12 relative overflow-hidden border-l"
          style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)' }}
        >
          {/* Elemento geometrico — cerchio accent */}
          <div
            className="absolute top-[-10%] right-[-15%] w-[500px] h-[500px] rounded-full opacity-10"
            style={{ background: 'var(--accent)' }}
          />
          <div
            className="absolute bottom-[15%] left-[-8%] w-[200px] h-[200px] rounded-full opacity-5"
            style={{ background: 'var(--accent)' }}
          />

          {/* Quote in basso */}
          <blockquote className="relative z-10 border-l-2 pl-6" style={{ borderColor: 'var(--accent)' }}>
            <p className="text-2xl font-semibold leading-snug tracking-tight mb-4">
              "Foolish è pelle sintetica fatta a mano, in Italia. Non imita la pelle: la interpreta."
            </p>
            <footer className="text-sm" style={{ color: 'var(--muted-fg)' }}>
              Alessandro · The Foolish Butcher
            </footer>
          </blockquote>
        </div>
      </section>

      {/* ── TRUST STRIP — No card, divide-x ── */}
      <section
        className="border-b grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 divide-y sm:divide-y-0 md:divide-x"
        style={{ borderColor: 'var(--border)' }}
      >
        {[
          {
            Icon: ShieldCheck,
            title: 'Pagamenti criptati',
            body: 'Nessun dato salvato. Non tracciamo nessun dato sensibile.',
          },
          {
            Icon: Truck,
            title: 'Spedizione tracciata',
            body: 'Se c\'è ritardo, ti mandiamo un foglio in più.',
          },
          {
            Icon: MessageSquare,
            title: 'Supporto vero',
            body: 'Scrivi. Rispondiamo noi. Anche di notte, spesso.',
          },
          {
            Icon: Package,
            title: 'Spedizione gratuita',
            body: 'Italia da 55 € · Europa da 164 € · Mondo da 250 €',
          },
        ].map(({ Icon, title, body }) => (
          <div key={title} className="px-6 py-7 flex gap-4 items-start" style={{ borderColor: 'var(--border)' }}>
            <Icon
              size={18}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0"
              style={{ color: 'var(--accent)' }}
            />
            <div>
              <p className="text-sm font-semibold mb-1">{title}</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{body}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── LIMITED STOCK ── */}
      {limitedProducts.length > 0 && (
        <section className="border-b px-8 md:px-16 py-14" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
          <div className="max-w-7xl mx-auto">
            <div className="flex items-end justify-between mb-8">
              <div>
                <p className="text-xs font-bold tracking-[0.2em] uppercase mb-2" style={{ color: 'var(--limited)' }}>
                  Stock limitato
                </p>
                <h2 className="text-2xl font-bold tracking-tight">Colorazioni rare — disponibili ora</h2>
              </div>
              <Link href="/limited" className="text-xs tracking-wide hover:underline shrink-0" style={{ color: 'var(--accent)' }}>
                Vedi tutti →
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

      {/* ── SEZIONE TATTOO — asimmetrica: label sinistra, griglia destra ── */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-16">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_2.5fr] gap-12 items-start">
            {/* Label colonna */}
            <div className="md:sticky md:top-24">
              <p className="text-xs uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--muted-fg)' }}>Sezione</p>
              <h2 className="text-4xl font-bold tracking-tight mb-4">Tattoo</h2>
              <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--muted-fg)' }}>
                Tatua meglio, a partire da adesso.
              </p>
              <Link href="/tattoo" className="text-xs tracking-wide hover:underline" style={{ color: 'var(--accent)' }}>
                Vedi tutti →
              </Link>
            </div>

            {/* Griglia prodotti */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {tattooProducts.slice(0, 3).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── MANIFESTO PRODUZIONE — testo editoriale ── */}
      <section
        className="border-b px-8 md:px-16 py-20"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}
      >
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-16 items-end">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] mb-6" style={{ color: 'var(--accent)' }}>
              Il processo
            </p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tighter leading-tight mb-8">
              Ogni pelle<br />è un pezzo unico.
            </h2>
            <div className="space-y-4 text-base leading-relaxed" style={{ color: 'var(--muted-fg)' }}>
              <p>
                Foolish non compra la pelle, la fa. Dall'inizio. A mano. Da un silicone puro al platino,
                trasformato in superficie grazie a un processo proprietario che non troverai altrove.
              </p>
              <p>
                Il colore? Non è stampato. È vivo. Usiamo flock: microfili di nylon sospesi, che durante
                la catalisi si fissano a profondità diverse. Nuance inaspettate, discromie reali, texture
                che cambiano a ogni prodotto.
              </p>
            </div>
          </div>

          {/* Stat laterale */}
          <div className="border-l pl-10" style={{ borderColor: 'var(--border)' }}>
            <div className="mb-8">
              <p className="text-5xl font-bold tracking-tighter mb-2" style={{ color: 'var(--accent)' }}>
                100%
              </p>
              <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>Ogni foglio fatto a mano</p>
            </div>
            <div className="mb-8">
              <p className="text-5xl font-bold tracking-tighter mb-2" style={{ color: 'var(--accent)' }}>
                0
              </p>
              <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>Pelli identiche prodotte</p>
            </div>
            <div>
              <p className="text-5xl font-bold tracking-tighter mb-2" style={{ color: 'var(--accent)' }}>
                2012
              </p>
              <p className="text-sm" style={{ color: 'var(--muted-fg)' }}>Anno di fondazione, Chieri (TO)</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SEZIONE PMU — layout speculare ── */}
      <section className="border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-7xl mx-auto px-8 md:px-16 py-16">
          <div className="grid grid-cols-1 md:grid-cols-[2.5fr_1fr] gap-12 items-start">
            {/* Griglia prodotti prima */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {pmuProducts.slice(0, 4).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>

            {/* Label colonna destra */}
            <div className="md:sticky md:top-24 md:text-right">
              <p className="text-xs uppercase tracking-[0.2em] mb-3" style={{ color: 'var(--muted-fg)' }}>Sezione</p>
              <h2 className="text-4xl font-bold tracking-tight mb-4">Permanent<br />Make-up</h2>
              <p className="text-sm leading-relaxed mb-6" style={{ color: 'var(--muted-fg)' }}>
                Pratica su supporti progettati per chi fa PMU sul serio.
              </p>
              <Link href="/pmu" className="text-xs tracking-wide hover:underline" style={{ color: 'var(--accent)' }}>
                Vedi tutti →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA FINALE ── */}
      <section className="px-8 md:px-16 py-24 text-center">
        <p className="text-xs uppercase tracking-[0.25em] mb-4" style={{ color: 'var(--accent)' }}>
          Da noi in Italia, per te, ovunque.
        </p>
        <h2 className="text-3xl md:text-5xl font-bold tracking-tighter mb-6">
          Fatta come serve.<br />Con carattere.
        </h2>
        <Link
          href="/tattoo"
          className="inline-block px-10 py-4 font-semibold text-sm tracking-wide transition-all duration-200 active:scale-[0.98]"
          style={{ backgroundColor: 'var(--accent)', color: '#0a0a0a' }}
        >
          Entra nel negozio
        </Link>
      </section>

    </div>
  )
}
