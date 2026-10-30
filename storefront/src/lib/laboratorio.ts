/**
 * Struttura della pagina `/laboratorio` (Il Pellaio — The Precision Inspector).
 *
 * I sei reparti sono una struttura dati, non sei blocchi copiati a mano: l'ordine e' quello
 * della lavagna dei turni e ogni voce legge le proprie chiavi dal locale corrente.
 */

export const STAFF_IDS = ['warehouse', 'secretary', 'callCentre', 'chemist', 'ceo', 'cleaning'] as const

export type StaffId = (typeof STAFF_IDS)[number]

export type StaffItem = {
  id: StaffId
  role: string
  /** Tratto del personaggio: nei testi approvati esiste solo in italiano e inglese. */
  trait: string
  quote: string
  /** Battuta fra parentesi che accompagna la citazione (call centre, CEO). */
  aside: string
}

/** Firma minima di un traduttore del namespace `laboratorio`. */
export type Translate = (key: string) => string

/** Ordine dei quattro paragrafi che raccontano le verita' tecniche, nominati per proprieta'. */
export const PARADOX_IDS = ['spessore', 'discromie', 'pori', 'strati'] as const

export type ParadoxId = (typeof PARADOX_IDS)[number]

/**
 * Estrae i sei reparti dalle traduzioni: ordine fisso, nessuna voce inventata.
 * `trait` puo' essere vuoto (lingue in cui il testo approvato non lo prevede) e in quel caso
 * la pagina non lo rende affatto.
 */
export function buildStaffItems(t: Translate): StaffItem[] {
  return STAFF_IDS.map((id) => ({
    id,
    role: t(`staff.items.${id}.role`),
    trait: t(`staff.items.${id}.trait`),
    quote: t(`staff.items.${id}.quote`),
    aside: t(`staff.items.${id}.aside`),
  }))
}

/** Percorso delle practice skin nella lingua corrente. */
export function practiceSkinHref(locale: string): string {
  return `/${locale}/tattoo`
}

/** Bot del laboratorio: unico recapito del CTA. */
export const TELEGRAM_BOT_URL = 'https://t.me/the_foolish_butcher_bot'
