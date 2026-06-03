'use client'

import type { ReactNode } from 'react'

interface TrustBadgeProps {
  children: ReactNode
  title: string
  body: string
}

export function TrustBadge({ children, title, body }: TrustBadgeProps) {
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
      <div className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }}>{children}</div>
      <div>
        <p className="text-label mb-1" style={{ color: 'var(--foreground)' }}>{title}</p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--muted-fg)' }}>{body}</p>
      </div>
    </div>
  )
}
