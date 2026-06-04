'use client'
import { useState } from 'react'
import { Star } from 'lucide-react'

interface Props {
  token: string
  locale: string
}

export function ReviewForm({ token, locale }: Props) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const labels: Record<string, string[]> = {
    it: ['Pessimo', 'Scarso', 'Nella media', 'Buono', 'Eccellente'],
    en: ['Terrible', 'Poor', 'Average', 'Good', 'Excellent'],
    fr: ['Terrible', 'Mauvais', 'Moyen', 'Bon', 'Excellent'],
    de: ['Schlecht', 'Schwach', 'Mittelmäßig', 'Gut', 'Ausgezeichnet'],
    es: ['Pésimo', 'Malo', 'Regular', 'Bueno', 'Excelente'],
  }
  const ctaLabel: Record<string, string> = {
    it: 'Invia recensione', en: 'Submit review', fr: 'Envoyer l\'avis',
    de: 'Bewertung senden', es: 'Enviar reseña',
  }
  const l = labels[locale] ?? labels.it

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (rating === 0) { setError('Seleziona un voto'); return }

    setUploading(true)
    let photoUrls: string[] = []
    if (photo) {
      const fd = new FormData()
      fd.append('file', photo)
      const res = await fetch('/api/review/photo', { method: 'POST', body: fd })
      if (!res.ok) { setError('Errore upload foto'); setUploading(false); return }
      const data = await res.json()
      photoUrls = [data.url]
    }

    const res = await fetch('/api/review/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, rating, reviewText: text, reviewerName: name, photoUrls }),
    })
    setUploading(false)
    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Errore invio')
      return
    }
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="text-center py-16">
        <p className="text-4xl mb-4">✦</p>
        <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          {locale === 'it' ? 'Grazie.' : 'Thank you.'}
        </h2>
        <p style={{ color: 'var(--muted-fg)' }}>
          {locale === 'it' ? 'La tua recensione è in fase di revisione.' : 'Your review is being reviewed.'}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto space-y-6 py-8">
      {/* Stelle */}
      <div>
        <div className="flex gap-2 justify-center mb-2">
          {[1,2,3,4,5].map((s) => (
            <button
              key={s} type="button"
              onClick={() => setRating(s)}
              onMouseEnter={() => setHovered(s)}
              onMouseLeave={() => setHovered(0)}
            >
              <Star
                size={36}
                fill={(hovered || rating) >= s ? '#c8a97e' : 'none'}
                stroke="#c8a97e"
              />
            </button>
          ))}
        </div>
        {(hovered || rating) > 0 && (
          <p className="text-center text-sm" style={{ color: '#c8a97e' }}>
            {l[(hovered || rating) - 1]}
          </p>
        )}
      </div>

      {/* Nome */}
      <div>
        <input
          type="text"
          placeholder={locale === 'it' ? 'Il tuo nome (es. Mario R.)' : 'Your name'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl px-4 py-3 text-sm border"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
      </div>

      {/* Testo */}
      <div>
        <textarea
          placeholder={locale === 'it' ? 'Racconta la tua esperienza (opzionale)' : 'Share your experience (optional)'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full rounded-xl px-4 py-3 text-sm border resize-none"
          style={{ backgroundColor: 'var(--card)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
        />
      </div>

      {/* Foto */}
      <div>
        <label className="block text-sm mb-2" style={{ color: 'var(--muted-fg)' }}>
          {locale === 'it' ? 'Foto del tuo lavoro (opzionale, max 5MB)' : 'Photo of your work (optional, max 5MB)'}
        </label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="text-sm"
          style={{ color: 'var(--muted-fg)' }}
        />
        {photo && <p className="text-xs mt-1" style={{ color: '#c8a97e' }}>{photo.name}</p>}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={uploading || rating === 0}
        className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
        style={{ backgroundColor: '#c8a97e', color: '#000' }}
      >
        {uploading ? '...' : ctaLabel[locale] ?? ctaLabel.it}
      </button>
    </form>
  )
}
