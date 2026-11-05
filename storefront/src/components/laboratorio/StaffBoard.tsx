import { buildStaffItems, type Translate } from '@/lib/laboratorio'

type StaffBoardProps = {
  t: Translate
  /** Etichetta della lavagna dei turni (`TODAY'S STAFF`), identica in tutte le lingue. */
  label: string
  /** Frase che introduce la lavagna. */
  intro: string
}

/**
 * I sei reparti del Pellaio: la lavagna dei turni e' una lista ordinata, generata dalla
 * struttura dati (`STAFF_IDS`), non sei blocchi scritti a mano. Ogni voce e' un `<li>`, la
 * citazione porta le sue virgolette e la battuta fra parentesi ha testo proprio: nessuna
 * informazione e' affidata al solo colore.
 */
export function StaffBoard({ t, label, intro }: StaffBoardProps) {
  const items = buildStaffItems(t)

  return (
    <div className="max-w-3xl">
      <p
        className="inline-block text-[11px] font-bold uppercase tracking-[0.35em] px-3 py-2 border"
        style={{ color: '#c9a96e', borderColor: '#3a2f22' }}
      >
        {label}
      </p>
      <p className="mt-6 mb-10 text-lg sm:text-xl" style={{ color: '#e8dcc8' }}>
        {intro}
      </p>

      <ol className="divide-y" style={{ borderColor: '#1e1812' }}>
        {items.map((item) => (
          <li key={item.id} className="py-8 first:pt-0 last:pb-0" style={{ borderColor: '#1e1812' }}>
            <h3
              className="text-xs sm:text-sm font-bold uppercase tracking-[0.25em] break-words"
              style={{ color: '#c9a96e' }}
            >
              {item.role}
            </h3>
            {item.trait ? (
              <p className="mt-2 text-sm" style={{ color: '#a89880' }}>
                {item.trait}
              </p>
            ) : null}
            <p
              className="mt-3 text-lg sm:text-xl leading-relaxed font-display"
              style={{ color: '#e8dcc8' }}
            >
              {item.quote}
            </p>
            {item.aside ? (
              <p className="mt-2 text-sm italic" style={{ color: '#a89880' }}>
                {item.aside}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  )
}
