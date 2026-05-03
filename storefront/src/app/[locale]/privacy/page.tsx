import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — The Foolish Butcher',
}

export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-8 text-sm leading-relaxed text-[var(--muted-fg)]">
      <h1 className="font-bebas text-4xl tracking-wide text-[var(--fg)]">Privacy Policy</h1>
      <p className="text-xs text-[var(--muted-fg)]">Ultimo aggiornamento: maggio 2025</p>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Titolare del trattamento</h2>
        <p>
          The Foolish Butcher · Chieri (TO), Italia · P.IVA IT12475480013<br />
          <a href="mailto:info@thefoolishbutcher.com" className="underline">info@thefoolishbutcher.com</a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Dati raccolti</h2>
        <p>In fase di acquisto raccogliamo:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Nome e cognome</li>
          <li>Indirizzo email</li>
          <li>Indirizzo di spedizione</li>
          <li>ID Telegram (opzionale, per notifiche ordine)</li>
        </ul>
        <p>
          I dati di pagamento sono gestiti esclusivamente da Stripe Inc. e non transitano
          né vengono conservati sui nostri server.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Finalità del trattamento</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Evasione e gestione degli ordini</li>
          <li>Comunicazioni sullo stato della spedizione</li>
          <li>Assistenza post-vendita</li>
          <li>Adempimenti fiscali e contabili</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Base giuridica</h2>
        <p>
          Il trattamento &#232; necessario all&#8217;esecuzione del contratto di vendita (art. 6.1.b GDPR)
          e all&#8217;adempimento di obblighi legali (art. 6.1.c GDPR).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Conservazione</h2>
        <p>
          I dati sono conservati per il tempo necessario all&#8217;evasione dell&#8217;ordine e,
          per gli obblighi fiscali, per 10 anni ai sensi della normativa italiana vigente.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Diritti dell&#8217;interessato</h2>
        <p>
          Ai sensi del GDPR (artt. 15&#8211;22) hai diritto di accedere, rettificare, cancellare i tuoi dati,
          opporti al trattamento e richiedere la portabilit&#224;. Scrivi a{' '}
          <a href="mailto:info@thefoolishbutcher.com" className="underline">info@thefoolishbutcher.com</a>.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-[var(--fg)]">Cookie</h2>
        <p>
          Questo sito non utilizza cookie di profilazione o tracciamento di terze parti.
          Vengono utilizzati esclusivamente cookie tecnici necessari al funzionamento del carrello.
        </p>
      </section>
    </div>
  )
}
