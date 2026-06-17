import Link from 'next/link'
import type { ResellerProduct } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'

interface Props {
  product: ResellerProduct
}

export function ProductCard({ product }: Props) {
  const image = product.images?.[0]
  const minTierDiscount = product.priceTiers?.length
    ? Math.max(...product.priceTiers.map(t => t.discountPercent))
    : 0

  return (
    <Link href={`/catalogo/${product.slug}`} className="group block border border-stone-200 rounded-lg overflow-hidden hover:border-stone-400 transition-colors">
      {image && (
        <div className="aspect-square bg-stone-100 overflow-hidden">
          <img
            src={`${process.env.NEXT_PUBLIC_CMS_URL}${image.url}`}
            alt={image.alt ?? product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        </div>
      )}
      <div className="p-4">
        <h2 className="font-medium text-sm">{product.name}</h2>
        <p className="text-stone-500 text-xs mt-1">
          Da {formatPrice(product.variants?.[0]?.price ?? product.basePrice)}/pz
        </p>
        {minTierDiscount > 0 && (
          <span className="inline-block mt-2 bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded">
            Fino a -{minTierDiscount}%
          </span>
        )}
      </div>
    </Link>
  )
}
