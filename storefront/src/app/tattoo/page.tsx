import { getProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export const metadata = { title: 'Tattoo Practice — The Foolish Butcher' }

export default async function TattooPage() {
  const products = await getProducts('tattoo')
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="mb-10">
        <p className="text-xs uppercase tracking-widest mb-2" style={{ color: 'var(--muted-fg)' }}>Sezione</p>
        <h1 className="text-3xl font-bold">Tattoo Practice</h1>
        <p className="mt-3 max-w-xl" style={{ color: 'var(--muted-fg)' }}>
          Pelle sintetica artigianale per chi impara e per chi insegna. Ogni foglio è prodotto a mano — nessuno uguale all'altro.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
        {products.map((p) => <ProductCard key={p.id} product={p} />)}
      </div>
      {products.length === 0 && (
        <p className="text-center py-20" style={{ color: 'var(--muted-fg)' }}>Nessun prodotto disponibile al momento.</p>
      )}
    </div>
  )
}
