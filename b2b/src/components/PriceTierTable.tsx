import type { PriceTier } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'

interface Props {
  tiers: PriceTier[]
  basePrice: number
  currentQty?: number
}

export function PriceTierTable({ tiers, basePrice, currentQty = 0 }: Props) {
  if (!tiers || tiers.length === 0) return null

  return (
    <div className="mt-4">
      <p className="text-xs text-stone-500 uppercase tracking-wide mb-2">Prezzi a volume</p>
      <table className="w-full text-sm border border-stone-200 rounded overflow-hidden">
        <thead className="bg-stone-100">
          <tr>
            <th className="text-left px-3 py-2">Quantità</th>
            <th className="text-left px-3 py-2">Sconto</th>
            <th className="text-right px-3 py-2">Prezzo/pz</th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((tier, i) => {
            const isActive = currentQty >= tier.minQty && (tier.maxQty === null || currentQty <= tier.maxQty)
            const discountedPrice = basePrice * (1 - tier.discountPercent / 100)
            const label = tier.maxQty ? `${tier.minQty}–${tier.maxQty} pz` : `${tier.minQty}+ pz`
            return (
              <tr
                key={i}
                className={isActive ? 'bg-green-50 font-medium' : 'border-t border-stone-100'}
              >
                <td className="px-3 py-2">{label}</td>
                <td className="px-3 py-2 text-green-700">-{tier.discountPercent}%</td>
                <td className="px-3 py-2 text-right">{formatPrice(discountedPrice)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
