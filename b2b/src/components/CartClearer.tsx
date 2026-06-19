'use client'
import { useEffect } from 'react'
import { useCart } from '@/lib/cart'

export function CartClearer() {
  const { clear } = useCart()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { clear() }, [])
  return null
}
