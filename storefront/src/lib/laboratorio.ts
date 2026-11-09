/**
 * Struttura della pagina `/laboratorio` (Il Pellaio — The Foolish Butcher).
 *
 * Le sette voci di «Una giornata» sono una struttura dati che vive nei file di traduzione
 * (`laboratorio.giornata.items`, un array di `{ ora, ruolo, testo }`): il componente non
 * contiene nessun orario e nessun testo scritto a mano.
 */

/**
 * Le sei figure dei ruoli (ritagli provvisori, non l'hero).
 *
 * La mappatura e' esplicita: ruolo canonico (italiano, lingua di default) -> file, e le
 * dimensioni sono quelle **intrinseche** dei WebP in `storefront/public/pellaio/personaggi/`.
 * Servono a `next/image` per riservare lo spazio prima del caricamento (nessun layout shift):
 * il test le confronta con l'header VP8X dei file veri, quindi una figura sostituita senza
 * aggiornare la tabella fa fallire il test invece di deformare la pagina.
 *
 * L'aggancio con i testi tradotti e' l'**orario**: le `ora` sono identiche nelle cinque lingue,
 * mentre `ruolo` e' tradotto. L'`alt` vive nei file lingua (`giornata.items[i].alt`) e
 * `buildGiornataItems` lo pretende presente esattamente dove c'e' una figura.
 */
export type FiguraGiornata = {
  /** Ruolo canonico: la stessa parola che la pagina mostra in italiano. */
  ruolo: string
  /** Percorso pubblico del WebP (dentro `storefront/public`). */
  src: string
  /** Larghezza intrinseca del file, in pixel. */
  width: number
  /** Altezza intrinseca del file, in pixel. */
  height: number
}

const FIGURE_DIR = '/pellaio/personaggi'

const FIGURE_GIORNATA_TABLE: readonly FiguraGiornata[] = [
  { ruolo: 'Magazziniere', src: `${FIGURE_DIR}/pellaio-magazziniere.webp`, width: 341, height: 720 },
  { ruolo: 'Segreteria', src: `${FIGURE_DIR}/pellaio-segretaria.webp`, width: 341, height: 720 },
  { ruolo: 'Call center', src: `${FIGURE_DIR}/pellaio-call-center.webp`, width: 272, height: 720 },
  { ruolo: 'Chimico', src: `${FIGURE_DIR}/pellaio-chimico.webp`, width: 236, height: 720 },
  { ruolo: 'CEO', src: `${FIGURE_DIR}/pellaio-ceo.webp`, width: 293, height: 720 },
  { ruolo: 'Pulizie', src: `${FIGURE_DIR}/pellaio-pulizie.webp`, width: 266, height: 720 },
] as const

/** Orari con una figura, nell'ordine in cui compaiono nella giornata (le 23:58 non ne hanno). */
const ORE_CON_FIGURA = ['07:12', '09:40', '11:05', '14:20', '16:45', '19:30'] as const

/** Tabella ruolo -> file, con le dimensioni reali. Copia immutabile: la pagina non la muta. */
export const FIGURE_GIORNATA: readonly FiguraGiornata[] = FIGURE_GIORNATA_TABLE

/** La figura del ruolo che lavora a quell'ora, oppure `null` se la voce non ha un reparto. */
export function figuraPerOra(ora: string): FiguraGiornata | null {
  const index = (ORE_CON_FIGURA as readonly string[]).indexOf(ora)
  if (index < 0) return null
  return FIGURE_GIORNATA_TABLE[index] ?? null
}

/** Una voce della giornata: orario, ruolo (puo' essere vuoto), cosa succede e alt della figura. */
export type GiornataItem = {
  ora: string
  ruolo: string
  testo: string
  /** Descrizione della figura del ruolo, tradotta. Vuota quando la voce non ha una figura. */
  alt: string
}

/** Firma minima di un traduttore del namespace `laboratorio`. */
export type Translate = (key: string) => string

/**
 * Normalizza l'array delle voci orarie che arriva dalle traduzioni.
 *
 * Fail-closed: un valore che non e' un array di `{ ora, ruolo, testo }` stringa e' un errore di
 * contenuto, non un caso da rendere a meta'. `ruolo` puo' essere vuoto (la voce delle 23:58 non
 * ha un reparto) e in quel caso la pagina non lo rende affatto.
 *
 * `alt` e' obbligatorio **esattamente** dove c'e' una figura (`figuraPerOra`) e vietato altrove:
 * un alt vuoto sulla voce con la figura, o un alt orfano su una voce senza reparto, e' un errore
 * di contenuto. Cosi' una traduzione dimenticata non pubblica un'immagine senza descrizione, e
 * non resta in pagina un alt che parla di una figura che non c'e'.
 */
export function buildGiornataItems(raw: unknown): GiornataItem[] {
  if (!Array.isArray(raw)) {
    throw new Error('laboratorio.giornata.items deve essere un array di { ora, ruolo, testo }')
  }
  return raw.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`laboratorio.giornata.items[${index}] non e' un oggetto`)
    }
    const { ora, ruolo, testo } = entry as Record<string, unknown>
    for (const [field, value] of Object.entries({ ora, ruolo, testo })) {
      if (typeof value !== 'string') {
        throw new Error(`laboratorio.giornata.items[${index}].${field} deve essere una stringa`)
      }
    }
    const altRaw = (entry as Record<string, unknown>).alt
    if (altRaw !== undefined && typeof altRaw !== 'string') {
      throw new Error(`laboratorio.giornata.items[${index}].alt deve essere una stringa`)
    }
    const alt = typeof altRaw === 'string' ? altRaw.trim() : ''
    const figura = figuraPerOra(ora as string)
    if (figura && alt.length === 0) {
      throw new Error(`laboratorio.giornata.items[${index}].alt manca: la voce ${ora} ha una figura (${figura.ruolo})`)
    }
    if (!figura && alt.length > 0) {
      throw new Error(`laboratorio.giornata.items[${index}].alt non ammesso: la voce ${ora} non ha una figura`)
    }
    return { ora: ora as string, ruolo: ruolo as string, testo: testo as string, alt }
  })
}

/** Percorso delle practice skin nella lingua corrente. */
export function practiceSkinHref(locale: string): string {
  return `/${locale}/tattoo`
}

/** Bot del laboratorio: unico recapito del CTA. */
export const TELEGRAM_BOT_URL = 'https://t.me/the_foolish_butcher_bot'
