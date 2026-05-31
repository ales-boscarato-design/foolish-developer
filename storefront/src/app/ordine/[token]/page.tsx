import { notFound } from 'next/navigation'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────────────
type PipelineState =
  | 'received' | 'eta_pending' | 'eta_confirmed' | 'in_production'
  | 'matching_pending' | 'matched' | 'preview_sent'
  | 'shipped' | 'delivered' | 'followup_done' | 'closed'

interface ContentBlock {
  type: 'guide' | 'announcement' | 'offer' | 'tip'
  title: string
  body: string
  ctaLabel?: string
  ctaUrl?: string
}

interface SheetPhoto {
  url: string
  caption?: string
}

interface OrderData {
  orderNumber: string
  customerName?: string
  customerLocale?: string
  pipelineState: PipelineState
  productionEtaDays?: number
  trackingNumber?: string
  trackingCarrier?: string
  createdAt: string
  lineItems: Array<{ name: string; variantLabel?: string; quantity: number }>
  sheetPhotos: SheetPhoto[]
  contentBlocks: ContentBlock[]
}

// ── Pipeline steps ─────────────────────────────────────────
const STEPS: { state: PipelineState; label: string; sublabel?: string }[] = [
  { state: 'received',         label: 'Ordine ricevuto' },
  { state: 'in_production',    label: 'In produzione',   sublabel: 'Alessandro sta lavorando' },
  { state: 'matched',          label: 'Fogli pronti',    sublabel: 'Abbinati al tuo ordine' },
  { state: 'shipped',          label: 'Spedito' },
  { state: 'delivered',        label: 'Consegnato' },
]

const STATE_ORDER: PipelineState[] = [
  'received', 'eta_pending', 'eta_confirmed',
  'in_production', 'matching_pending', 'matched',
  'preview_sent', 'shipped', 'delivered', 'followup_done', 'closed',
]

function stepIndex(state: PipelineState) {
  // Map pipeline state to visible step index
  const map: Partial<Record<PipelineState, number>> = {
    received: 0, eta_pending: 0, eta_confirmed: 0,
    in_production: 1, matching_pending: 1,
    matched: 2, preview_sent: 2,
    shipped: 3,
    delivered: 4, followup_done: 4, closed: 4,
  }
  return map[state] ?? 0
}

const BLOCK_ACCENT: Record<ContentBlock['type'], string> = {
  guide:        '#c9a96e',
  announcement: '#6b8fa3',
  offer:        '#7a6b3a',
  tip:          '#5a7a5a',
}

const BLOCK_LABEL: Record<ContentBlock['type'], string> = {
  guide:        'Guida',
  announcement: 'Aggiornamento',
  offer:        'Offerta',
  tip:          'Suggerimento',
}

// ── Data fetch ─────────────────────────────────────────────
async function getOrder(token: string): Promise<OrderData | null> {
  const base = process.env.NEXT_PUBLIC_SITE_URL || 'https://thefoolishbutcher.com'
  try {
    const res = await fetch(`${base}/api/order/${token}`, {
      next: { revalidate: 60 },
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

// ── Page ──────────────────────────────────────────────────
export default async function OrderPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const order = await getOrder(token)
  if (!order) notFound()

  const currentStep = stepIndex(order.pipelineState)
  const firstName = order.customerName?.split(' ')[0] ?? ''

  return (
    <main style={{ backgroundColor: '#0d0b08', minHeight: '100vh', color: '#e8e0d0' }}>

      {/* Header */}
      <header style={{
        borderBottom: '1px solid #2a2318',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <a href="https://thefoolishbutcher.com" style={{ display: 'flex', alignItems: 'center' }}>
          <Image
            src="/logo-dark.png"
            alt="The Foolish Butcher"
            width={32}
            height={32}
            style={{ opacity: 0.9 }}
          />
        </a>
        <span style={{ color: '#6b5f4a', fontSize: '13px' }}>
          Ordine <strong style={{ color: '#c9a96e' }}>#{order.orderNumber}</strong>
        </span>
      </header>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* Greeting */}
        <div style={{ marginBottom: '40px' }}>
          <p style={{ fontSize: '13px', color: '#6b5f4a', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            The Foolish Butcher · Chieri, Torino
          </p>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0, color: '#f0e8d8' }}>
            {firstName ? `Ciao ${firstName}.` : 'Il tuo ordine.'}
          </h1>
        </div>

        {/* Timeline */}
        <section style={{ marginBottom: '48px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {STEPS.map((step, i) => {
              const done    = i < currentStep
              const active  = i === currentStep
              const pending = i > currentStep

              return (
                <div key={step.state} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                  {/* Dot + line */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      marginTop: '3px',
                      background: done ? '#c9a96e' : active ? '#f0e8d8' : '#2a2318',
                      border: `2px solid ${done || active ? '#c9a96e' : '#3a3020'}`,
                      flexShrink: 0,
                    }} />
                    {i < STEPS.length - 1 && (
                      <div style={{
                        width: '2px',
                        height: '36px',
                        background: done ? '#c9a96e' : '#2a2318',
                        margin: '4px 0',
                      }} />
                    )}
                  </div>

                  {/* Text */}
                  <div style={{ paddingBottom: i < STEPS.length - 1 ? '0' : '0', paddingTop: '0' }}>
                    <p style={{
                      margin: 0,
                      fontSize: active ? '16px' : '14px',
                      fontWeight: active ? 700 : 400,
                      color: pending ? '#4a4030' : active ? '#f0e8d8' : '#9a8870',
                    }}>
                      {step.label}
                    </p>
                    {active && step.sublabel && (
                      <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#6b5f4a' }}>
                        {step.sublabel}
                      </p>
                    )}
                    {active && order.productionEtaDays && order.pipelineState === 'in_production' && (
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#c9a96e' }}>
                        ETA: ~{order.productionEtaDays} giorni
                      </p>
                    )}
                    {active && order.trackingNumber && order.pipelineState === 'shipped' && (
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#c9a96e' }}>
                        {order.trackingCarrier} · {order.trackingNumber}
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Sheet photos */}
        {order.sheetPhotos.length > 0 && (
          <section style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b5f4a', marginBottom: '16px' }}>
              I tuoi fogli
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '12px',
            }}>
              {order.sheetPhotos.map((photo, i) => (
                <div key={i} style={{ borderRadius: '4px', overflow: 'hidden', background: '#1a1510' }}>
                  <img
                    src={photo.url}
                    alt={photo.caption || `Foglio ${i + 1}`}
                    style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }}
                  />
                  {photo.caption && (
                    <p style={{ margin: 0, padding: '8px 10px', fontSize: '11px', color: '#6b5f4a', lineHeight: 1.4 }}>
                      {photo.caption}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Content blocks */}
        {order.contentBlocks.length > 0 && (
          <section style={{ marginBottom: '48px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h2 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b5f4a', marginBottom: '4px' }}>
              Da Alessandro
            </h2>
            {order.contentBlocks.map((block, i) => (
              <div key={i} style={{
                borderLeft: `3px solid ${BLOCK_ACCENT[block.type]}`,
                background: '#13110e',
                borderRadius: '0 4px 4px 0',
                padding: '16px 20px',
              }}>
                <p style={{ margin: '0 0 6px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: BLOCK_ACCENT[block.type] }}>
                  {BLOCK_LABEL[block.type]}
                </p>
                <p style={{ margin: '0 0 8px', fontSize: '15px', fontWeight: 700, color: '#f0e8d8' }}>
                  {block.title}
                </p>
                <p style={{ margin: 0, fontSize: '14px', color: '#9a8870', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                  {block.body}
                </p>
                {block.ctaLabel && block.ctaUrl && (
                  <a
                    href={block.ctaUrl}
                    style={{
                      display: 'inline-block',
                      marginTop: '14px',
                      padding: '8px 16px',
                      background: BLOCK_ACCENT[block.type],
                      color: '#0d0b08',
                      fontSize: '12px',
                      fontWeight: 700,
                      textDecoration: 'none',
                      borderRadius: '3px',
                    }}
                  >
                    {block.ctaLabel} →
                  </a>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Order summary */}
        <section>
          <h2 style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#6b5f4a', marginBottom: '12px' }}>
            Riepilogo ordine
          </h2>
          <div style={{ background: '#13110e', borderRadius: '4px', padding: '16px 20px' }}>
            {(order.lineItems as Array<{ name: string; variantLabel?: string; quantity: number }>).map((item, i) => (
              <div key={i} style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 0',
                borderBottom: i < order.lineItems.length - 1 ? '1px solid #1e1a14' : 'none',
                fontSize: '14px',
              }}>
                <span style={{ color: '#c9c0b0' }}>
                  {item.name}{item.variantLabel ? ` — ${item.variantLabel}` : ''}
                </span>
                <span style={{ color: '#6b5f4a' }}>×{item.quantity}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <div style={{ marginTop: '48px', textAlign: 'center' }}>
          <p style={{ fontSize: '12px', color: '#3a3020' }}>
            thefoolishbutcher.com · Chieri (TO), Italia · Made in Italy
          </p>
        </div>

      </div>
    </main>
  )
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const order = await getOrder(token)
  if (!order) return { title: 'Ordine non trovato' }
  return {
    title: `Ordine #${order.orderNumber} — The Foolish Butcher`,
    robots: 'noindex',
  }
}
