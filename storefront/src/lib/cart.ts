'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProductVariant, Product } from './cms'

export interface CartItem {
  productId: string
  productName: string
  productSlug: string
  sku: string
  variantLabel: string
  price: number
  quantity: number
  image?: string
  selectedAttrs: Record<string, string>
}

interface CartState {
  items: CartItem[]
  add: (product: Product, variant: ProductVariant, selectedAttrs?: Record<string, string>, qty?: number) => void
  remove: (sku: string) => void
  updateQty: (sku: string, qty: number) => void
  clear: () => void
  total: () => number
  itemCount: () => number
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (product, variant, selectedAttrs: Record<string, string> = {}, qty = 1) => {
        set((state) => {
          const cartKey = `${variant.sku}-${JSON.stringify(selectedAttrs)}`
          const newItem: CartItem = {
            productId: product.id,
            productName: product.name,
            productSlug: product.slug,
            sku: variant.sku,
            variantLabel: variant.label,
            price: variant.price,
            quantity: qty,
            image: product.images[0]?.image?.sizes?.thumbnail?.url ?? product.images[0]?.image?.url,
            selectedAttrs,
          }
          const existing = state.items.find((i) => i.sku === variant.sku && JSON.stringify(i.selectedAttrs) === cartKey)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.sku === variant.sku && JSON.stringify(i.selectedAttrs) === cartKey
                  ? { ...i, quantity: i.quantity + qty }
                  : i,
              ),
            }
          }
          return { items: [...state.items, newItem] }
        })
      },

      remove: (sku) => set((state) => ({ items: state.items.filter((i) => i.sku !== sku) })),

      updateQty: (sku, qty) => {
        if (qty <= 0) {
          get().remove(sku)
          return
        }
        set((state) => ({
          items: state.items.map((i) => (i.sku === sku ? { ...i, quantity: qty } : i)),
        }))
      },

      clear: () => set({ items: [] }),

      total: () => get().items.reduce((sum, i) => sum + i.price * i.quantity, 0),

      itemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
    }),
    { name: 'foolish-cart' },
  ),
)
