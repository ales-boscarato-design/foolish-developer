import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PriceTier } from './cms'
import { calculateLineTotal } from './pricing'

export interface CartItem {
  productId: number
  productSlug: string
  productName: string
  variantSku: string
  variantLabel: string
  unitPrice: number
  qty: number
  priceTiers: PriceTier[]
}

interface CartStore {
  items: CartItem[]
  addItem: (item: CartItem) => void
  updateQty: (sku: string, qty: number) => void
  removeItem: (sku: string) => void
  clear: () => void
  total: () => number
  itemCount: () => number
}

export const useCart = create<CartStore>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (item) => set(state => {
        const existing = state.items.find(i => i.variantSku === item.variantSku)
        if (existing) {
          return {
            items: state.items.map(i =>
              i.variantSku === item.variantSku
                ? { ...i, qty: i.qty + item.qty }
                : i
            ),
          }
        }
        return { items: [...state.items, item] }
      }),

      updateQty: (sku, qty) => set(state => ({
        items: qty <= 0
          ? state.items.filter(i => i.variantSku !== sku)
          : state.items.map(i => i.variantSku === sku ? { ...i, qty } : i),
      })),

      removeItem: (sku) => set(state => ({
        items: state.items.filter(i => i.variantSku !== sku),
      })),

      clear: () => set({ items: [] }),

      total: () => get().items.reduce(
        (sum, item) => sum + calculateLineTotal(item.unitPrice, item.qty, item.priceTiers),
        0
      ),

      itemCount: () => get().items.reduce((sum, item) => sum + item.qty, 0),
    }),
    { name: 'b2b-cart' }
  )
)
