import type { Metadata } from 'next'

const BASE = 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const langs = Object.fromEntries(LOCALES.map(l => [l, `${BASE}/${l}/pro`]))
  return {
    title: 'Foolish Pro — The Foolish Butcher',
    description:
      locale === 'it'
        ? 'Diventa un rivenditore Foolish Pro. Accesso a prezzi dedicati e materiali esclusivi per professionisti del tattoo e PMU.'
        : 'Become a Foolish Pro reseller. Access dedicated pricing and exclusive materials for tattoo and PMU professionals.',
    alternates: {
      canonical: `${BASE}/${locale}/pro`,
      languages: { ...langs, 'x-default': `${BASE}/it/pro` },
    },
  }
}

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
