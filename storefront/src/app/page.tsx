import Link from 'next/link'
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
      {/* Hero */}
      <section className="relative border-b px-4 py-24 md:py-36 text-center" style={{ borderColor: 'var(--border)' }}>
        <p className="text-xs tracking-[0.3em] uppercase mb-4" style={{ color: 'var(--muted-fg)' }}>
          Fatto a mano · Chieri, Italia · Dal 2012
        </p>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 leading-tight">
          Pelle sintetica<br />
          <span style={{ color: 'var(--accent)' }}>che non dimentica</span><br />
          di essere unica.
        </h1>
        <p className="max-w-lg mx-auto mb-10 text-base md:text-lg" style={{ color: 'var(--muted-fg)' }}>
          Ogni foglio è diverso. Ogni ordine è irripetibile.<br />
          Esattamente come la pelle dei tuoi clienti.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/tattoo"
            className="px-6 py-3 font-semibold rounded transition-colors"
            style={{ backgroundColor: 'var(--accent)', color: 'black' }}
          >
            Tattoo Practice
          </Link>
          <Link
            href="/pmu"
            className="px-6 py-3 border rounded transition-colors hover:border-[var(--accent)]"
          >
            Permanent Make-up
          </Link>
        </div>
      </section>

      {/* Limited Stock — solo se ci sono prodotti */}
      {limitedProducts.length > 0 && (
        <section className="border-b px-4 py-12" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <div>
                <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--limited)' }}>
                  🔥 Stock Limitato
                </span>
                <h2 className="text-xl font-bold mt-1">Colorazioni rare — disponibili ora</h2>
              </div>
              <Link href="/limited" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
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

      {/* Sezione Tattoo */}
      <section className="border-b px-4 py-14" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--muted-fg)' }}>Sezione</p>
              <h2 className="text-2xl font-bold">Tattoo</h2>
            </div>
            <Link href="/tattoo" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
              Vedi tutti →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {tattooProducts.slice(0, 3).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      {/* Sezione PMU */}
      <section className="px-4 py-14">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--muted-fg)' }}>Sezione</p>
              <h2 className="text-2xl font-bold">Permanent Make-up</h2>
            </div>
            <Link href="/pmu" className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>
              Vedi tutti →
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {pmuProducts.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </div>
      </section>

      {/* Brand statement */}
      <section className="border-t px-4 py-16 text-center" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
        <blockquote className="max-w-2xl mx-auto">
          <p className="text-xl md:text-2xl font-medium leading-relaxed">
            "Non è pelle sintetica generica.<br />
            È pelle sintetica fatta a mano, in Italia,<br />
            da chi tatuatori e artiste PMU le conosce davvero."
          </p>
          <footer className="mt-4 text-sm" style={{ color: 'var(--muted-fg)' }}>Alessandro · The Foolish Butcher</footer>
        </blockquote>
      </section>
    </div>
  )
}
