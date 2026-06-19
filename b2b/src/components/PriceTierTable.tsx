'use client'
import { useTranslations } from 'next-intl'
import type { PriceTier } from '@/lib/cms'
import { formatPrice } from '@/lib/pricing'

interface Props { tiers: PriceTier[]; basePrice: number; currentQty?: number }

export function PriceTierTable({ tiers, basePrice, currentQty = 0 }: Props) {
  const t = useTranslations('PriceTierTable')

  if (!tiers || tiers.length === 0) return null

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <p style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--muted-fg)', marginBottom: '0.75rem' }}>
        {t('prezziVolume')}
      </p>
      <div style={{ border: '1px solid var(--border)', borderRadius: '0.75rem', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-3)' }}>
              {[t('quantita'), t('sconto'), t('prezzoPz')].map(h => (
                <th key={h} style={{ padding: '0.6rem 1rem', textAlign: h === t('prezzoPz') ? 'right' : 'left', fontWeight: 500, fontSize: '0.75rem', color: 'var(--muted-fg)', letterSpacing: '0.04em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier, i) => {
              const isActive = currentQty >= tier.minQty && (tier.maxQty === null || currentQty <= tier.maxQty)
              const price = basePrice * (1 - tier.discountPercent / 100)
              const label = tier.maxQty ? t('rangePz', { min: tier.minQty, max: tier.maxQty }) : t('minPlusPz', { min: tier.minQty })
              return (
                <tr key={i} style={{
                  borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                  background: isActive ? 'rgba(200,169,126,0.06)' : 'transparent',
                  transition: `background var(--dur-fast)`,
                }}>
                  <td style={{ padding: '0.65rem 1rem', fontWeight: isActive ? 500 : 400 }}>{label}</td>
                  <td style={{ padding: '0.65rem 1rem', color: 'var(--accent)', fontWeight: isActive ? 600 : 400 }}>-{tier.discountPercent}%</td>
                  <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontWeight: isActive ? 600 : 400, color: isActive ? 'var(--accent)' : 'var(--foreground)' }}>{formatPrice(price)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
