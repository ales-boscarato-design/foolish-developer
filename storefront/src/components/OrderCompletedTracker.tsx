'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics'

interface OrderCompletedTrackerProps {
  orderRef: string | null
  total: number
  itemCount: number
}

export function OrderCompletedTracker({ orderRef, total, itemCount }: OrderCompletedTrackerProps) {
  useEffect(() => {
    track('order_completed', {
      ...(orderRef ? { order_ref: orderRef } : {}),
      total,
      items: itemCount,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
