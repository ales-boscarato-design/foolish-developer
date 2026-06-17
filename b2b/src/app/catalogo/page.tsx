import { fetchResellerProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export const revalidate = 60

export default async function CatalogoPage() {
  const products = await fetchResellerProducts()

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Catalogo Rivenditori</h1>
      {products.length === 0 ? (
        <p className="text-stone-400">Nessun prodotto disponibile al momento.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {products.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  )
}
