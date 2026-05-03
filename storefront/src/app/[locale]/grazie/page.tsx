import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

export async function generateMetadata() {
  const t = await getTranslations('grazie')
  return { title: `${t('title')} — The Foolish Butcher` }
}

export default async function GraziePage() {
  const t = await getTranslations('grazie')
  return (
    <div className="max-w-xl mx-auto px-4 py-24 text-center">
      <div className="text-5xl mb-6">✓</div>
      <h1 className="text-2xl font-bold mb-3">{t('title')}</h1>
      <p className="mb-6" style={{ color: 'var(--muted-fg)' }}>
        {t('subtitle')}<br />{t('subtitleLine2')}
      </p>
      <div className="rounded-lg p-5 mb-8 border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--muted)' }}>
        <p className="font-medium mb-2">{t('telegramTitle')}</p>
        <p className="text-sm mb-4" style={{ color: 'var(--muted-fg)' }}>{t('telegramBody')}</p>
        <a
          href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'foolishbutcherbot'}?start=neworder`}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded font-semibold text-sm"
          style={{ backgroundColor: '#229ED9', color: 'white' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.248l-2.04 9.614c-.146.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.903.607z"/>
          </svg>
          {t('telegramCta')}
        </a>
      </div>
      <Link href="/" className="text-sm hover:underline" style={{ color: 'var(--muted-fg)' }}>{t('backToShop')}</Link>
    </div>
  )
}
