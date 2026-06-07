import { notFound } from 'next/navigation'
import Image from 'next/image'

// ── Types ─────────────────────────────────────────────────
type PipelineState =
  | 'received' | 'eta_pending' | 'eta_confirmed' | 'in_production'
  | 'matching_pending' | 'matched' | 'preview_sent'
  | 'shipped' | 'delivered' | 'followup_done' | 'closed'

type Locale = 'it' | 'en' | 'de' | 'fr' | 'es'

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

// ── i18n ──────────────────────────────────────────────────
type StepDef = { label: string; sublabel?: string }

interface PageStrings {
  orderLabel: string
  greeting: (name: string) => string
  steps: StepDef[]
  eta: (days: number) => string
  sheetPhotos: string
  photoAlt: (i: number) => string
  fromAlessandro: string
  blockLabels: Record<ContentBlock['type'], string>
  orderSummary: string
  notFound: string
  metaTitle: (orderNumber: string) => string
}

const STRINGS: Record<Locale, PageStrings> = {
  it: {
    orderLabel: 'Ordine',
    greeting: (name) => name ? `Ciao ${name}.` : 'Il tuo ordine.',
    steps: [
      { label: 'Ordine ricevuto' },
      { label: 'In produzione', sublabel: 'Alessandro sta lavorando' },
      { label: 'Fogli pronti', sublabel: 'Abbinati al tuo ordine' },
      { label: 'Spedito' },
      { label: 'Consegnato' },
    ],
    eta: (days) => `ETA: ~${days} giorni`,
    sheetPhotos: 'I tuoi fogli',
    photoAlt: (i) => `Foglio ${i + 1}`,
    fromAlessandro: 'Da Alessandro',
    blockLabels: { guide: 'Guida', announcement: 'Aggiornamento', offer: 'Offerta', tip: 'Suggerimento' },
    orderSummary: 'Riepilogo ordine',
    notFound: 'Ordine non trovato',
    metaTitle: (n) => `Ordine #${n} — The Foolish Butcher`,
  },
  en: {
    orderLabel: 'Order',
    greeting: (name) => name ? `Hi ${name}.` : 'Your order.',
    steps: [
      { label: 'Order received' },
      { label: 'In production', sublabel: 'Alessandro is working on it' },
      { label: 'Sheets ready', sublabel: 'Matched to your order' },
      { label: 'Shipped' },
      { label: 'Delivered' },
    ],
    eta: (days) => `ETA: ~${days} days`,
    sheetPhotos: 'Your sheets',
    photoAlt: (i) => `Sheet ${i + 1}`,
    fromAlessandro: 'From Alessandro',
    blockLabels: { guide: 'Guide', announcement: 'Update', offer: 'Offer', tip: 'Tip' },
    orderSummary: 'Order summary',
    notFound: 'Order not found',
    metaTitle: (n) => `Order #${n} — The Foolish Butcher`,
  },
  de: {
    orderLabel: 'Bestellung',
    greeting: (name) => name ? `Hallo ${name}.` : 'Deine Bestellung.',
    steps: [
      { label: 'Bestellung eingegangen' },
      { label: 'In Produktion', sublabel: 'Alessandro arbeitet daran' },
      { label: 'Bögen bereit', sublabel: 'Deiner Bestellung zugeordnet' },
      { label: 'Versandt' },
      { label: 'Geliefert' },
    ],
    eta: (days) => `Lieferzeit: ~${days} Tage`,
    sheetPhotos: 'Deine Bögen',
    photoAlt: (i) => `Bogen ${i + 1}`,
    fromAlessandro: 'Von Alessandro',
    blockLabels: { guide: 'Anleitung', announcement: 'Update', offer: 'Angebot', tip: 'Tipp' },
    orderSummary: 'Bestellübersicht',
    notFound: 'Bestellung nicht gefunden',
    metaTitle: (n) => `Bestellung #${n} — The Foolish Butcher`,
  },
  fr: {
    orderLabel: 'Commande',
    greeting: (name) => name ? `Bonjour ${name}.` : 'Votre commande.',
    steps: [
      { label: 'Commande reçue' },
      { label: 'En production', sublabel: 'Alessandro travaille dessus' },
      { label: 'Feuilles prêtes', sublabel: 'Attribuées à votre commande' },
      { label: 'Expédiée' },
      { label: 'Livrée' },
    ],
    eta: (days) => `Délai estimé : ~${days} jours`,
    sheetPhotos: 'Vos feuilles',
    photoAlt: (i) => `Feuille ${i + 1}`,
    fromAlessandro: 'De Alessandro',
    blockLabels: { guide: 'Guide', announcement: 'Mise à jour', offer: 'Offre', tip: 'Conseil' },
    orderSummary: 'Récapitulatif',
    notFound: 'Commande introuvable',
    metaTitle: (n) => `Commande #${n} — The Foolish Butcher`,
  },
  es: {
    orderLabel: 'Pedido',
    greeting: (name) => name ? `Hola ${name}.` : 'Tu pedido.',
    steps: [
      { label: 'Pedido recibido' },
      { label: 'En producción', sublabel: 'Alessandro está trabajando' },
      { label: 'Hojas listas', sublabel: 'Asignadas a tu pedido' },
      { label: 'Enviado' },
      { label: 'Entregado' },
    ],
    eta: (days) => `Estimación: ~${days} días`,
    sheetPhotos: 'Tus hojas',
    photoAlt: (i) => `Hoja ${i + 1}`,
    fromAlessandro: 'De Alessandro',
    blockLabels: { guide: 'Guía', announcement: 'Actualización', offer: 'Oferta', tip: 'Consejo' },
    orderSummary: 'Resumen del pedido',
    notFound: 'Pedido no encontrado',
    metaTitle: (n) => `Pedido #${n} — The Foolish Butcher`,
  },
}

function getStrings(locale?: string): PageStrings {
  const l = (locale ?? 'it') as Locale
  return STRINGS[l] ?? STRINGS.it
}

// ── Pipeline steps ─────────────────────────────────────────
const STATE_STEP_INDEX: Partial<Record<PipelineState, number>> = {
  received: 0, eta_pending: 0, eta_confirmed: 0,
  in_production: 1, matching_pending: 1,
  matched: 2, preview_sent: 2,
  shipped: 3,
  delivered: 4, followup_done: 4, closed: 4,
}

function stepIndex(state: PipelineState) {
  return STATE_STEP_INDEX[state] ?? 0
}

const BLOCK_ACCENT: Record<ContentBlock['type'], string> = {
  guide:        '#c9a96e',
  announcement: '#6b8fa3',
  offer:        '#7a6b3a',
  tip:          '#5a7a5a',
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

  const t = getStrings(order.customerLocale)
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
          {t.orderLabel} <strong style={{ color: '#c9a96e' }}>#{order.orderNumber}</strong>
        </span>
      </header>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '32px 24px 64px' }}>

        {/* Greeting */}
        <div style={{ marginBottom: '40px' }}>
          <p style={{ fontSize: '13px', color: '#6b5f4a', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            The Foolish Butcher · Chieri, Torino
          </p>
          <h1 style={{ fontSize: '28px', fontWeight: 700, margin: 0, color: '#f0e8d8' }}>
            {t.greeting(firstName)}
          </h1>
        </div>

        {/* Timeline */}
        <section style={{ marginBottom: '48px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {t.steps.map((step, i) => {
              const done    = i < currentStep
              const active  = i === currentStep
              const pending = i > currentStep

              return (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
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
                    {i < t.steps.length - 1 && (
                      <div style={{
                        width: '2px',
                        height: '36px',
                        background: done ? '#c9a96e' : '#2a2318',
                        margin: '4px 0',
                      }} />
                    )}
                  </div>

                  {/* Text */}
                  <div style={{ paddingTop: '0' }}>
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
                        {t.eta(order.productionEtaDays)}
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
              {t.sheetPhotos}
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
                    alt={photo.caption || t.photoAlt(i)}
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
              {t.fromAlessandro}
            </h2>
            {order.contentBlocks.map((block, i) => (
              <div key={i} style={{
                borderLeft: `3px solid ${BLOCK_ACCENT[block.type]}`,
                background: '#13110e',
                borderRadius: '0 4px 4px 0',
                padding: '16px 20px',
              }}>
                <p style={{ margin: '0 0 6px', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: BLOCK_ACCENT[block.type] }}>
                  {t.blockLabels[block.type]}
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
            {t.orderSummary}
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
  if (!order) {
    const t = getStrings()
    return { title: t.notFound }
  }
  const t = getStrings(order.customerLocale)
  return {
    title: t.metaTitle(order.orderNumber),
    robots: 'noindex',
  }
}
