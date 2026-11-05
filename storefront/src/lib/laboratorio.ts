/**
 * Struttura della pagina `/laboratorio` (Il Pellaio — The Foolish Butcher).
 *
 * Le sette voci di «Una giornata» sono una struttura dati che vive nei file di traduzione
 * (`laboratorio.giornata.items`, un array di `{ ora, ruolo, testo }`): il componente non
 * contiene nessun orario e nessun testo scritto a mano.
 */

/** Una voce della giornata: orario, ruolo (puo' essere vuoto) e cosa succede a quell'ora. */
export type GiornataItem = {
  ora: string
  ruolo: string
  testo: string
}

/** Firma minima di un traduttore del namespace `laboratorio`. */
export type Translate = (key: string) => string

/**
 * Normalizza l'array delle voci orarie che arriva dalle traduzioni.
 *
 * Fail-closed: un valore che non e' un array di `{ ora, ruolo, testo }` stringa e' un errore di
 * contenuto, non un caso da rendere a meta'. `ruolo` puo' essere vuoto (la voce delle 23:58 non
 * ha un reparto) e in quel caso la pagina non lo rende affatto.
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
    return { ora: ora as string, ruolo: ruolo as string, testo: testo as string }
  })
}

/** Percorso delle practice skin nella lingua corrente. */
export function practiceSkinHref(locale: string): string {
  return `/${locale}/tattoo`
}

/** Bot del laboratorio: unico recapito del CTA. */
export const TELEGRAM_BOT_URL = 'https://t.me/the_foolish_butcher_bot'
