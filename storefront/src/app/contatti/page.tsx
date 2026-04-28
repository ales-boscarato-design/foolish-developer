import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Contatti — The Foolish Butcher',
  description: 'Contatta The Foolish Butcher per ordini, supporto o informazioni sui prodotti.',
}

export default function ContattiPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-10">
      <h1 className="font-bebas text-4xl tracking-wide">Contatti</h1>

      <section className="space-y-3 text-[var(--muted-fg)] leading-relaxed">
        <p>
          Per domande su ordini, prodotti o spedizioni scrivi direttamente — rispondiamo entro 24 ore,
          spesso molto prima.
        </p>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-fg)] mb-1">Email</p>
          <a
            href="mailto:info@thefoolishbutcher.com"
            className="text-lg hover:opacity-70 transition-opacity"
          >
            info@thefoolishbutcher.com
          </a>
        </div>

        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-fg)] mb-1">Telegram</p>
          <a
            href="https://t.me/foolishbot"
            className="text-lg hover:opacity-70 transition-opacity"
            target="_blank"
            rel="noopener noreferrer"
          >
            @foolishbot
          </a>
          <p className="text-sm text-[var(--muted-fg)] mt-1">
            Il modo più veloce per ricevere aggiornamenti sul tuo ordine.
          </p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-fg)] mb-1">Sede</p>
          <p>The Foolish Butcher</p>
          <p className="text-[var(--muted-fg)]">Chieri (TO), Italia</p>
          <p className="text-[var(--muted-fg)]">P.IVA IT12475480013</p>
        </div>
      </section>
    </div>
  )
}
