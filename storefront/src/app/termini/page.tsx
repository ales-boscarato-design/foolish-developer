import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Termini e condizioni — The Foolish Butcher',
}

export default function TerminiPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-8 text-sm leading-relaxed text-[var(--muted-fg)]">
      <h1 className="font-bebas text-4xl tracking-wide text-[var(--fg)]">Termini e condizioni</h1>
      <p className="text-xs text-[var(--muted-fg)]">Ultimo aggiornamento: maggio 2025</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">1. Venditore</h2>
        <p>
          The Foolish Butcher, con sede in Chieri (TO), Italia · P.IVA IT12475480013 ·{' '}
          <a href="mailto:info@thefoolishbutcher.com" className="underline">info@thefoolishbutcher.com</a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">2. Prodotti</h2>
        <p>
          I prodotti venduti sono articoli artigianali per la pratica del tatuaggio e del trucco permanente (PMU).
          Ogni pezzo è prodotto manualmente — variazioni di colore, texture e sfumatura sono caratteristiche
          intrinseche del processo produttivo, non difetti.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">3. Prezzi e pagamenti</h2>
        <p>
          Tutti i prezzi sono espressi in Euro (€) IVA inclusa. Il pagamento avviene tramite Stripe
          (carta di credito/debito, Apple Pay, Google Pay). L'ordine si considera confermato al completamento
          del pagamento.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">4. Spedizione</h2>
        <p>
          Le spedizioni avvengono dall'Italia entro 3–5 giorni lavorativi dalla conferma dell'ordine,
          salvo periodi di alta domanda comunicati esplicitamente.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Italia: 7,65€ · gratuita sopra 50€</li>
          <li>Europa: 14,99€ · gratuita sopra 150€</li>
          <li>Resto del mondo: 37,95€ · gratuita sopra 250€</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">5. Diritto di recesso</h2>
        <p>
          Ai sensi del D.Lgs. 206/2005, il consumatore ha diritto di recedere dal contratto entro 14 giorni
          dalla ricezione del prodotto, senza necessità di fornire motivazione, a condizione che il prodotto
          sia integro e non utilizzato. Per avviare il recesso scrivere a{' '}
          <a href="mailto:info@thefoolishbutcher.com" className="underline">info@thefoolishbutcher.com</a>.
        </p>
        <p>
          Il diritto di recesso non si applica a prodotti personalizzati o confezionati su misura.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">6. Garanzia</h2>
        <p>
          I prodotti sono coperti dalla garanzia legale di conformità di 2 anni prevista dalla normativa
          italiana ed europea (D.Lgs. 206/2005). Per segnalare difetti di conformità contattare{' '}
          <a href="mailto:info@thefoolishbutcher.com" className="underline">info@thefoolishbutcher.com</a>{' '}
          entro 2 mesi dalla scoperta.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">7. Responsabilità</h2>
        <p>
          I prodotti sono destinati esclusivamente alla pratica su materiali sintetici. Il venditore declina
          ogni responsabilità per utilizzi impropri o su tessuto umano.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">8. Foro competente</h2>
        <p>
          Per qualsiasi controversia è competente il Foro di Torino. La legge applicabile è quella italiana.
        </p>
      </section>
    </div>
  )
}
