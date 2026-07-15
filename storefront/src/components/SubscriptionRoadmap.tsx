'use client'
import { useState } from 'react'
import { SUBSCRIPTION_LADDER, type PlanKey, type Zone } from '@/lib/subscription-plans'

interface Props {
  plan: PlanKey
  labels: {
    tabIt: string
    tabEu: string
    cycle1: string
    cycle2: string
    cycle6: string
    shippingIncluded: string
    perMonth: string
  }
}

export function SubscriptionRoadmap({ plan, labels }: Props) {
  const [zone, setZone] = useState<Zone>('IT')
  const config = SUBSCRIPTION_LADDER[plan][zone]
  const stepLabels = [labels.cycle1, labels.cycle2, labels.cycle6]

  return (
    <div className="fb-wrap">
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        {(['IT', 'EU'] as const).map((z) => (
          <button
            key={z}
            onClick={() => setZone(z)}
            style={{
              fontFamily: 'system-ui, sans-serif', fontSize: '11px', letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '7px 16px', borderRadius: '20px',
              border: `1px solid ${zone === z ? 'var(--accent)' : 'var(--border)'}`,
              color: zone === z ? 'var(--accent)' : 'var(--muted-fg)', background: 'transparent', cursor: 'pointer',
            }}
          >
            {z === 'IT' ? labels.tabIt : labels.tabEu}
          </button>
        ))}
      </div>

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '4px', padding: '24px' }}>
        <div style={{ display: 'flex' }}>
          {config.phases.map((phase, i) => (
            <div key={i} style={{ flex: 1, textAlign: 'center', position: 'relative', paddingTop: '20px' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'var(--accent)' }} />
              <div style={{
                position: 'absolute', top: '-4px', left: '50%', transform: 'translateX(-50%)',
                width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent)',
              }} />
              <div className="stat-number" style={{ fontSize: '30px', color: 'var(--accent)' }}>
                {String(i === 0 ? 1 : i === 1 ? 2 : 6).padStart(2, '0')}
              </div>
              <div style={{ fontFamily: 'system-ui, sans-serif', color: 'var(--foreground)', fontSize: '12px', marginTop: '6px' }}>
                {stepLabels[i]}
              </div>
              <div className="text-mono" style={{ fontSize: '11px', color: 'var(--foreground)', marginTop: '4px' }}>
                €{(phase.productPrice + phase.shippingPrice).toFixed(2)} {labels.perMonth}
              </div>
              {phase.shippingPrice === 0 && (
                <div style={{ fontSize: '10px', color: 'var(--accent)', marginTop: '2px' }}>{labels.shippingIncluded}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
