'use client'
import { useState } from 'react'
import type { ProductImage } from '@/lib/cms'

interface Props {
  images: ProductImage[]
  alt: string
}

export function SubscriptionGallery({ images, alt }: Props) {
  const [active, setActive] = useState(0)
  const activeImage = images[active]

  return (
    <div>
      <div className="relative aspect-square rounded overflow-hidden" style={{ background: 'var(--muted)' }}>
        {activeImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activeImage.image.url} alt={activeImage.alt ?? alt} className="w-full h-full object-cover" />
        )}
      </div>
      {images.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {images.map((img, i) => (
            <button
              key={img.image.url + i}
              onClick={() => setActive(i)}
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '4px',
                overflow: 'hidden',
                padding: 0,
                border: `2px solid ${i === active ? 'var(--accent)' : 'var(--border)'}`,
                background: 'var(--muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.image.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
