'use client'
import { useState, useEffect } from 'react'
import type { Review } from '@/lib/reviews-db'

interface Props {
  reviews: Pick<Review, 'rating' | 'body' | 'reviewer_name' | 'product_slug'>[]
  productNames: Record<string, string>
}

export function ReviewQuote({ reviews, productNames }: Props) {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (reviews.length < 2) return
    const interval = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % reviews.length)
        setVisible(true)
      }, 400)
    }, 6000)
    return () => clearInterval(interval)
  }, [reviews.length])

  if (reviews.length === 0) return null
  const r = reviews[index]

  return (
    <section className="py-16 text-center px-4 border-b" style={{ borderColor: 'var(--border)' }}>
      <div
        style={{
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }}
      >
        <p style={{ color: '#c8a97e', fontSize: 14, letterSpacing: '0.1em', marginBottom: 16 }}>
          {'★'.repeat(r.rating)}
        </p>
        <p
          style={{
            color: 'var(--foreground)',
            fontStyle: 'italic',
            fontSize: 18,
            lineHeight: 1.6,
            maxWidth: 560,
            margin: '0 auto 16px',
            fontFamily: 'Georgia, serif',
          }}
        >
          &ldquo;{r.body}&rdquo;
        </p>
        <p style={{ color: 'var(--muted-fg)', fontSize: 13 }}>
          — {r.reviewer_name ?? 'Cliente'} · {productNames[r.product_slug] ?? r.product_slug}
        </p>
      </div>
    </section>
  )
}
