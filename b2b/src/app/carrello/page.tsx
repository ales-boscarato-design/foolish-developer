'use client'
import { useCart } from '@/lib/cart'
import { calculateLineTotal, formatPrice } from '@/lib/pricing'
import Link from 'next/link'

export default function CarrelloPage() {
  const { items, updateQty, removeItem, total } = useCart()

  if (items.length === 0) {
    return (
      <div className="text-center mt-20">
        <p className="text-stone-400 mb-4">Il carrello è vuoto.</p>
        <Link href="/catalogo" className="text-sm underline">Torna al catalogo</Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Carrello</h1>

      <div className="divide-y divide-stone-100">
        {items.map(item => {
          const lineTotal = calculateLineTotal(item.unitPrice, item.qty, item.priceTiers)
          return (
            <div key={item.variantSku} className="py-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium text-sm">{item.productName}</p>
                <p className="text-stone-400 text-xs">{item.variantLabel}</p>
              </div>
              <div className="flex items-center border border-stone-200 rounded">
                <button
                  onClick={() => updateQty(item.variantSku, item.qty - 1)}
                  className="px-2 py-1"
                >−</button>
                <span className="px-3 text-sm">{item.qty}</span>
                <button
                  onClick={() => updateQty(item.variantSku, item.qty + 1)}
                  className="px-2 py-1"
                >+</button>
              </div>
              <div className="text-sm font-medium w-20 text-right">{formatPrice(lineTotal)}</div>
              <button
                onClick={() => removeItem(item.variantSku)}
                className="text-stone-300 hover:text-red-400 text-xs"
              >✕</button>
            </div>
          )
        })}
      </div>

      <div className="mt-6 pt-4 border-t border-stone-200 flex items-center justify-between">
        <div>
          <p className="text-sm text-stone-500">Totale (IVA inclusa)</p>
          <p className="text-2xl font-semibold">{formatPrice(total())}</p>
          <p className="text-xs text-stone-400 mt-1">+ spedizione calcolata al checkout</p>
        </div>
        <Link
          href="/checkout"
          className="bg-stone-900 text-white px-8 py-3 rounded text-sm hover:bg-stone-700 transition-colors"
        >
          Procedi al checkout →
        </Link>
      </div>
    </div>
  )
}
