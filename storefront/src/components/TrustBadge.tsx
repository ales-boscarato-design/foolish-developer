'use client'

import type { ElementType } from 'react'

interface TrustBadgeProps {
  Icon: ElementType
  title: string
  body: string
}

export function TrustBadge({ Icon, title, body }: TrustBadgeProps) {
  return (
    <div
      className="px-7 py-8 flex gap-4 items-start transition-colors"
      style={{
        borderColor: 'var(--border)',
        transitionDuration: 'var(--dur-fast)',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(200,169,126,0.15)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)' }}
    >
      <Icon size={16} strokeWidth={1.5} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
      <div>
        <p className="text-label mb-1" style={{ color: 'var(--foreground)' }}>{title}</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{body}</p>
      </div>
    </div>
  )
}
