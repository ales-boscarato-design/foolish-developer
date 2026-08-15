import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'

interface PageProps {
  params: Promise<{ code: string; locale: string }>
}

async function getProMember(discountCode: string) {
  const token = process.env.PAYLOAD_API_TOKEN
  try {
    const res = await fetch(
      `${CMS_URL}/api/pro-members?where[discountCode][equals]=${encodeURIComponent(discountCode)}&where[status][equals]=active&depth=0&limit=1`,
      {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        next: { revalidate: 60 },
      },
    )
    if (!res.ok) return null
    const data = await res.json()
    return data.docs?.[0] ?? null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { code } = await params
  return { title: `Foolish Pro — ${code}` }
}

export default async function ProCardPage({ params }: PageProps) {
  const { code } = await params
  const t = await getTranslations('pro')
  const member = await getProMember(code)

  if (!member) notFound()

  const joinedYear = member.joinedAt
    ? new Date(member.joinedAt).getFullYear()
    : new Date().getFullYear()

  return (
    <div className="max-w-sm mx-auto px-4 py-16">
      <div
        className="rounded-2xl border-2 p-8 text-center"
        style={{ borderColor: 'var(--accent)', backgroundColor: 'var(--card)' }}
      >
        <span
          className="text-xs font-bold tracking-widest uppercase block mb-6"
          style={{ color: 'var(--accent)' }}
        >
          {t('badge')}
        </span>

        <p className="font-bold text-xl mb-1">{member.contactName}</p>
        <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>{member.businessName}</p>

        <div
          className="rounded-lg px-5 py-3 mb-6 font-mono text-lg font-bold tracking-wider"
          style={{ backgroundColor: 'var(--muted)', color: 'var(--accent)' }}
        >
          {member.discountCode}
        </div>

        <ul className="text-sm text-left space-y-2 mb-6">
          {(['benefit1', 'benefit2', 'benefit3', 'benefit4'] as const).map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span style={{ color: 'var(--accent)' }}>✓</span>
              <span>{t(`card.${key}`)}</span>
            </li>
          ))}
        </ul>

        <p className="text-xs" style={{ color: 'var(--muted-fg)' }}>
          Membro dal {joinedYear}
        </p>
      </div>
    </div>
  )
}
