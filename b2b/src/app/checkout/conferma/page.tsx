export default async function ConfermaPage({
  searchParams,
}: {
  searchParams: Promise<{ ordine?: string; metodo?: string }>
}) {
  const { ordine, metodo } = await searchParams
  const isBonifico = metodo === 'bonifico'

  return (
    <div className="max-w-lg mx-auto mt-16 text-center">
      <div className="text-4xl mb-4">✓</div>
      <h1 className="text-2xl font-semibold mb-2">Ordine confermato</h1>
      <p className="text-stone-500 text-sm mb-6">
        Numero ordine: <strong>{ordine}</strong>
      </p>

      {isBonifico ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left text-sm">
          <p className="font-medium mb-2">Coordinate per il bonifico:</p>
          <p>Intestatario: <strong>The Foolish Butcher Srl</strong></p>
          <p>IBAN: <strong>DA_COMPLETARE</strong></p>
          <p className="text-stone-400 text-xs mt-2">
            Causale: {ordine} — inserisci il numero d&apos;ordine come causale.
          </p>
        </div>
      ) : (
        <p className="text-sm text-stone-500">Il pagamento è stato ricevuto.</p>
      )}

      <p className="text-sm text-stone-400 mt-4">
        Hai ricevuto la conferma d&apos;ordine via email.
      </p>

      <a
        href="/catalogo"
        className="inline-block mt-8 border border-stone-300 rounded px-6 py-2 text-sm hover:border-stone-500"
      >
        Continua ad acquistare
      </a>
    </div>
  )
}
