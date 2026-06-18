import { fetchResellerProducts } from '@/lib/cms'
import { ProductCard } from '@/components/ProductCard'

export const dynamic = 'force-dynamic'

export default async function CatalogoPage() {
  const products = await fetchResellerProducts()

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontFamily: 'var(--font-cormorant)', fontStyle: 'italic', fontWeight: 600, fontSize: '2rem', color: 'var(--foreground)', marginBottom: '0.375rem' }}>
          Catalogo
        </h1>
        <p style={{ fontSize: '0.85rem', color: 'var(--muted-fg)' }}>
          Prezzi riservati ai rivenditori autorizzati
        </p>
      </div>
      {products.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 0', color: 'var(--muted-fg)' }}>
          <p>Nessun prodotto disponibile al momento.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1.25rem' }}>
          {products.map(p => <ProductCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  )
}
