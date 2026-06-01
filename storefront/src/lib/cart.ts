'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProductVariant, Product, ProductPack } from './cms'

export interface CartItem {
  productId: string
  productName: string
  productSlug: string
  sku: string
  variantLabel: string
  price: number          // prezzo unitario effettivo (già scontato per i pack)
  quantity: number
  image?: string
  selectedAttrs: Record<string, string>
  packName?: string      // nome del pack se aggiunto come bundle
  originalUnitPrice?: number // prezzo unitario pieno (per strike-through)
}

interface CartState {
  items: CartItem[]
  add: (product: Product, variant: ProductVariant, selectedAttrs?: Record<string, string>, qty?: number) => void
  addPack: (product: Product, variant: ProductVariant, pack: ProductPack, selectedAttrs?: Record<string, string>) => void
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

      addPack: (product, variant, pack, selectedAttrs: Record<string, string> = {}) => {
        const discountedUnitPrice = variant.price * (1 - pack.discountPercent / 100)
        const packKey = `${variant.sku}-pack-${pack.id}`
        set((state) => {
          const existing = state.items.find((i) => i.sku === packKey)
          if (existing) {
            return {
              items: state.items.map((i) =>
                i.sku === packKey ? { ...i, quantity: i.quantity + pack.quantity } : i,
              ),
            }
          }
          const newItem: CartItem = {
            productId: product.id,
            productName: product.name,
            productSlug: product.slug,
            sku: packKey,
            variantLabel: variant.label,
            price: discountedUnitPrice,
            quantity: pack.quantity,
            image: product.images[0]?.image?.sizes?.thumbnail?.url ?? product.images[0]?.image?.url,
            selectedAttrs,
            packName: pack.name,
            originalUnitPrice: variant.price,
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
