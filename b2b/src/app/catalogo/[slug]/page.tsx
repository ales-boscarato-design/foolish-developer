'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ResellerProduct, ProductVariant } from '@/lib/cms'
import { calculateUnitPrice, calculateLineTotal, formatPrice } from '@/lib/pricing'
import { PriceTierTable } from '@/components/PriceTierTable'
import { useCart } from '@/lib/cart'

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const [slug, setSlug] = useState<string | null>(null)
  const [product, setProduct] = useState<ResellerProduct | null>(null)
  const [selectedVariant, setSelectedVariant] = useState<ProductVariant | null>(null)
  const [qty, setQty] = useState(1)
  const [added, setAdded] = useState(false)
  const { addItem } = useCart()
  const router = useRouter()

  useEffect(() => {
    params.then(p => setSlug(p.slug))
  }, [params])

  useEffect(() => {
    if (!slug) return
    fetch(`/api/catalog?slug=${slug}`)
      .then(r => r.json())
      .then(data => {
        setProduct(data)
        setSelectedVariant(data?.variants?.[0] ?? null)
      })
  }, [slug])

  if (!product) return <p className="text-stone-400">Caricamento...</p>

  const tiers = product.priceTiers ?? []
  const basePrice = selectedVariant?.price ?? product.basePrice
  const unitPrice = calculateUnitPrice(basePrice, qty, tiers)
  const lineTotal = calculateLineTotal(basePrice, qty, tiers)

  function handleAdd() {
    if (!selectedVariant) return
    addItem({
      productId: product!.id,
      productSlug: product!.slug,
      productName: product!.name,
      variantSku: selectedVariant.sku,
      variantLabel: selectedVariant.label,
      unitPrice: selectedVariant.price,
      qty,
      priceTiers: tiers,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 2000)
  }

  return (
    <div className="max-w-2xl">
      <button onClick={() => router.back()} className="text-sm text-stone-400 mb-6 hover:underline">
        ← Torna al catalogo
      </button>

      <h1 className="text-2xl font-semibold mb-2">{product.name}</h1>

      {product.variants && product.variants.length > 0 && (
        <div className="mb-4">
          <label className="block text-sm text-stone-500 mb-2">Formato</label>
          <div className="flex gap-2 flex-wrap">
            {product.variants.map(v => (
              <button
                key={v.sku}
                onClick={() => setSelectedVariant(v)}
                className={`border rounded px-3 py-1.5 text-sm transition-colors ${
                  selectedVariant?.sku === v.sku
                    ? 'border-stone-900 bg-stone-900 text-white'
                    : 'border-stone-300 hover:border-stone-500'
                }`}
              >
                {v.label} — {formatPrice(v.price)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm text-stone-500">Quantità</label>
        <div className="flex items-center border border-stone-300 rounded">
          <button onClick={() => setQty(q => Math.max(1, q - 1))} className="px-3 py-1 text-lg">−</button>
          <span className="px-4 text-sm">{qty}</span>
          <button onClick={() => setQty(q => q + 1)} className="px-3 py-1 text-lg">+</button>
        </div>
        <div className="text-sm">
          <span className="text-stone-500">Prezzo/pz: </span>
          <span className="font-medium">{formatPrice(unitPrice)}</span>
          {unitPrice < basePrice && (
            <span className="text-stone-400 line-through ml-2">{formatPrice(basePrice)}</span>
          )}
        </div>
      </div>

      <PriceTierTable tiers={tiers} basePrice={basePrice} currentQty={qty} />

      <div className="mt-6 flex items-center gap-4">
        <div className="text-lg font-semibold">Totale: {formatPrice(lineTotal)}</div>
        <button
          onClick={handleAdd}
          className="bg-stone-900 text-white px-6 py-2 rounded text-sm hover:bg-stone-700 transition-colors"
        >
          {added ? '✓ Aggiunto' : 'Aggiungi al carrello'}
        </button>
      </div>
    </div>
  )
}
