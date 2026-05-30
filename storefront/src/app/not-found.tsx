import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
      <p className="text-6xl font-bold mb-4" style={{ color: 'var(--accent)' }}>404</p>
      <h1 className="text-xl font-semibold mb-2">Pagina non trovata</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted-fg)' }}>
        La pagina che cerchi non esiste o è stata spostata.
      </p>
      <Link
        href="/"
        className="px-6 py-3 rounded font-semibold text-sm transition-opacity hover:opacity-80"
        style={{ backgroundColor: 'var(--accent)', color: 'black' }}
      >
        Torna allo shop
      </Link>
    </div>
  )
}
