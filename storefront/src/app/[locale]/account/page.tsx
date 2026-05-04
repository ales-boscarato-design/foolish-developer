'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { Package, ArrowRight, AlertCircle } from 'lucide-react'

interface LookupResult {
  orderNumber: string
  customerName: string
  total: number
  pipelineState: string
  createdAt: string
}

export default function AccountPage() {
  const t = useTranslations('account')
  const [orderNumber, setOrderNumber] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orderNumber.trim() || !email.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(
        `/api/ordine/lookup?orderNumber=${encodeURIComponent(orderNumber.trim())}&email=${encodeURIComponent(email.trim())}`,
      )
      const data = await res.json()
      if (!res.ok || !data.found) {
        setError(t('errorNotFound'))
      } else {
        setResult(data.order)
      }
    } catch {
      setError(t('errorNetwork') ?? t('errorNotFound'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-2">{t('title')}</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-fg)' }}>{t('intro')}</p>

      <form onSubmit={handleSearch} className="space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('orderNumberLabel')}</label>
          <input
            type="text"
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            placeholder={t('orderNumberPlaceholder')}
            required
            className="w-full px-3 py-2 rounded border text-sm"
            style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{t('emailLabel')}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('emailPlaceholder')}
            required
            className="w-full px-3 py-2 rounded border text-sm"
            style={{ backgroundColor: 'var(--muted)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 p-3 rounded text-sm" style={{ backgroundColor: 'var(--muted)', color: '#ef4444' }}>
            <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !orderNumber.trim() || !email.trim()}
          className="w-full py-3 rounded font-semibold text-sm transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: 'var(--accent)', color: 'black' }}
        >
          {loading ? t('searching') : t('search')}
        </button>
      </form>

      {result && (
        <div
          className="rounded-lg border p-5"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--card)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Package size={16} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>{t('orderFound')}</span>
          </div>
          <div className="space-y-1.5 text-sm mb-4">
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted-fg)' }}>{t('orderNumber')}</span>
              <span className="font-mono text-xs">{result.orderNumber}</span>
            </div>
            {result.customerName && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--muted-fg)' }}>Nome</span>
                <span>{result.customerName}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span style={{ color: 'var(--muted-fg)' }}>Totale</span>
              <span>{result.total.toFixed(2)}€</span>
            </div>
          </div>
          <Link
            href={`/account/ordine/${encodeURIComponent(result.orderNumber)}`}
            className="flex items-center justify-center gap-2 py-2.5 rounded font-semibold text-sm transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--accent)', color: 'black' }}
          >
            {t('viewDetails')}
            <ArrowRight size={14} />
          </Link>
        </div>
      )}

      <div className="mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
        <Link
          href="/"
          className="text-sm hover:underline"
          style={{ color: 'var(--muted-fg)' }}
        >
          {t('backToShop')}
        </Link>
      </div>
    </div>
  )
}
