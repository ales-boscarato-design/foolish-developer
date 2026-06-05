import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export const metadata: Metadata = {
  title: 'Contatti — The Foolish Butcher',
  description: 'Contatta The Foolish Butcher per ordini, supporto o informazioni sui prodotti.',
}

export default async function ContattiPage() {
  const t = await getTranslations('contatti')

  return (
    <div className="max-w-2xl mx-auto px-6 py-16 space-y-10">
      <h1 className="font-bebas text-4xl tracking-wide">{t('title')}</h1>

      <section className="space-y-3 text-[var(--muted-fg)] leading-relaxed">
        <p>{t('intro')}</p>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-fg)] mb-1">{t('emailLabel')}</p>
          <a
            href="mailto:info@thefoolishbutcher.com"
            className="text-lg hover:opacity-70 transition-opacity"
          >
            info@thefoolishbutcher.com
          </a>
        </div>

        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-fg)] mb-1">{t('telegramLabel')}</p>
          <a
            href="https://t.me/the_foolish_butcher_bot"
            className="text-lg hover:opacity-70 transition-opacity"
            target="_blank"
            rel="noopener noreferrer"
          >
            @the_foolish_butcher_bot
          </a>
          <p className="text-sm text-[var(--muted-fg)] mt-1">{t('telegramNote')}</p>
        </div>

        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--muted-fg)] mb-1">{t('sedeLabel')}</p>
          <p>{t('companyName')}</p>
          <p className="text-[var(--muted-fg)]">{t('location')}</p>
          <p className="text-[var(--muted-fg)]">{t('vat')}</p>
        </div>
      </section>
    </div>
  )
}
