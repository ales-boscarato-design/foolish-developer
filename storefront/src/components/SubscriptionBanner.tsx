import Link from 'next/link'

export function SubscriptionBanner({ locale, eyebrow, title, body, cta }: {
  locale: string
  eyebrow: string
  title: string
  body: string
  cta: string
}) {
  return (
    <section className="border-b" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-7xl mx-auto px-8 md:px-16 py-20 flex flex-col items-start">
        <p className="text-xs font-bold tracking-[0.4em] uppercase mb-4" style={{ color: 'var(--accent)' }}>{eyebrow}</p>
        <h2 className="font-display text-4xl md:text-6xl leading-none mb-5">{title}</h2>
        <p className="text-sm leading-relaxed mb-8 max-w-md" style={{ color: 'var(--muted-fg)' }}>{body}</p>
        <Link
          href={`/${locale}/abbonamento`}
          className="inline-flex items-center gap-2 text-sm font-semibold tracking-widest uppercase transition-opacity hover:opacity-70"
          style={{ color: 'var(--accent)' }}
        >
          {cta} →
        </Link>
      </div>
    </section>
  )
}
