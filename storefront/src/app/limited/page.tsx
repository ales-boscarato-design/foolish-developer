export const dynamic = 'force-dynamic'
import { getLimitedProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'
import { redirect } from 'next/navigation'

export const metadata = { title: '🔥 Stock Limitato — The Foolish Butcher' }

export default async function LimitedPage() {
  const products = await getLimitedProducts()

  // Se vuota → redirect homepage
  if (products.length === 0) redirect('/')

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-10">
        <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--limited)' }}>
          🔥 Disponibilità limitata
        </span>
        <h1 className="text-3xl font-bold mt-2">Colorazioni rare</h1>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-fg)' }}>
          Lotti speciali dalla produzione. Quando finiscono, non tornano — o almeno non uguali.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {products.map((p) => (
          <ProductCard key={p.id} product={p} showLimitedBadge />
        ))}
      </div>
    </div>
  )
}
