import { getShippingZone } from './shipping'

/**
 * Stima di consegna — UNA sola funzione calcola la data di un carrello.
 *
 * Il checkout del cliente, la rotta che serve la stima alla pagina e il
 * controllo 409 del checkout chiamano tutti `estimateCartDelivery`: se il
 * massimo di produzione, il margine o la zona si calcolassero in due punti, il
 * cliente vedrebbe una data e ne pagherebbe un'altra. La data mostrata e'
 * quella inviata al checkout, e il server la ricontrolla con questa stessa
 * funzione prima di aprire Stripe.
 *
 * Perche' le date nascono da componenti Europe/Rome via `Intl` e non da
 * `getHours()`/`getDate()`: la macchina che esegue il codice ha un fuso suo
 * (server in UTC, browser del cliente in un altro ancora). Il cutoff delle
 * 12:00 e' un'ora italiana e il calendario e' italiano, quindi si leggono
 * l'ora e la data italiane e si costruiscono giorni calendario in UTC: lo
 * stesso istante produce la stessa data ovunque giri il codice.
 */

export type DeliveryZone = 'IT_EU' | 'EXTRA_EU'

export type CartDeliveryReason = 'ok' | 'zone_unknown' | 'out_of_bounds'

export interface CartDeliveryItem {
  madeToOrder?: boolean
  productionDays?: number | null
}

export interface CartDeliveryEstimate {
  zone: DeliveryZone | null
  productionDays: number | null
  marginDays: number | null
  fallback: boolean
  date: string | null
  reason: CartDeliveryReason
}

/** Limite dichiarato: oltre questo la durata non e' una stima, e' un dato rotto. */
const MAX_PRODUCTION_DAYS = 3_650

/**
 * Margine dopo la produzione. Non e' il tempo del corriere in senso stretto: e'
 * il cuscinetto fra l'uscita dal laboratorio e la consegna promessa.
 */
const TRANSIT_MARGIN_DAYS: Record<DeliveryZone, number> = { IT_EU: 2, EXTRA_EU: 6 }

/**
 * Margine quando la durata di produzione e' ignota (CMS senza `productionDays`):
 * piu' prudente dell'attraversamento normale, perche' al posto di un numero
 * noto c'e' un'incognita. Si somma al massimo NOTO del carrello, non lo
 * sostituisce: un articolo da 60 giorni accanto a uno a durata ignota non puo'
 * partire il giorno dopo.
 */
const UNKNOWN_PRODUCTION_MARGIN_DAYS: Record<DeliveryZone, number> = { IT_EU: 3, EXTRA_EU: 7 }

const FIXED_ITALIAN_HOLIDAYS = [
  '01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26',
] as const

function easterMonday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  const result = new Date(Date.UTC(year, month - 1, day + 1))
  return dateKey(result)
}

const ROME_TIME_ZONE = 'Europe/Rome'

function dateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function isItalianWorkingDay(date: Date): boolean {
  const weekday = date.getUTCDay()
  const monthDay = dateKey(date).slice(5)
  return weekday !== 0 && weekday !== 6
    && !FIXED_ITALIAN_HOLIDAYS.includes(monthDay as (typeof FIXED_ITALIAN_HOLIDAYS)[number])
    && dateKey(date) !== easterMonday(date.getUTCFullYear())
}

/**
 * Giorno di calendario e ora (0-23) dell'istante dato, letti nel fuso italiano.
 * Gli orari sono su 24 ore: con `hour12` l'ora delle 12:00 non e' distinguibile
 * dalle 00:00 e il cutoff scivolerebbe di mezza giornata.
 */
function romeDateAndHour(now: Date): { date: Date; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ROME_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value
  const date = new Date(Date.UTC(Number(part('year')), Number(part('month')) - 1, Number(part('day'))))
  return { date, hour: Number(part('hour')) }
}

/** Il primo giorno in cui il pacco puo' uscire: oggi stesso solo se lavorativo e prima delle 12:00 italiane. */
function departureDay(now: Date): Date {
  const { date: today, hour } = romeDateAndHour(now)
  const departure = new Date(today)
  if (!isItalianWorkingDay(departure) || hour >= 12) {
    do departure.setUTCDate(departure.getUTCDate() + 1)
    while (!isItalianWorkingDay(departure))
  }
  return departure
}

/**
 * Aggiunge giorni LAVORATIVI italiani (sabato, domenica, festivita' fisse ed
 * Easter Monday esclusi). Input non valido = `RangeError`, mai un ciclo senza
 * fine: il chiamante che vuole una data "senza promesse" cattura l'errore.
 */
export function addItalianWorkingDays(start: Date, days: number): Date {
  if (!Number.isSafeInteger(days) || days < 0 || days > MAX_PRODUCTION_DAYS) {
    throw new RangeError('working-day estimate exceeds supported computation bound')
  }
  const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
  let remaining = days
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1)
    if (isItalianWorkingDay(date)) remaining -= 1
  }
  return date
}

/**
 * Zona commerciale della stima. Il paese assente NON diventa extra-UE: la
 * pagina non ha ancora scelto niente, e una data calcolata su una destinazione
 * inventata sarebbe una promessa falsa.
 */
function deliveryZoneForCountry(country: string | null | undefined): DeliveryZone | null {
  if (typeof country !== 'string') return null
  const code = country.trim()
  if (!code) return null
  return getShippingZone(code) === 'EXTRA_EU' ? 'EXTRA_EU' : 'IT_EU'
}

function workingDaysBetween(start: Date, of: { productionDays: number; marginDays: number }): Date {
  // Due chiamate separate, ognuna dentro il proprio bound: 3.650 + 7 giorni
  // lavorativi non devono mai diventare un `RangeError` in faccia al cliente.
  return addItalianWorkingDays(addItalianWorkingDays(start, of.productionDays), of.marginDays)
}

/**
 * Stima del carrello intero: UNA spedizione, quindi comanda l'articolo piu'
 * lento. Restituisce sempre un oggetto — non lancia e non blocca la vendita:
 * quando la data non e' calcolabile `date` e' null e `reason` dice perche'.
 */
export function estimateCartDelivery(args: {
  now?: Date
  country: string | null | undefined
  items: ReadonlyArray<CartDeliveryItem>
}): CartDeliveryEstimate {
  const now = args.now ?? new Date()
  const zone = deliveryZoneForCountry(args.country)
  if (!zone) {
    return { zone: null, productionDays: null, marginDays: null, fallback: false, date: null, reason: 'zone_unknown' }
  }

  let slowestKnownProductionDays = 0
  let productionUnknown = false
  for (const item of args.items) {
    // Un articolo a magazzino parte subito: contribuisce 0, non "sconosciuto".
    if (item.madeToOrder !== true) continue
    const days = item.productionDays
    if (days === undefined || days === null) {
      productionUnknown = true
      continue
    }
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0 || days > MAX_PRODUCTION_DAYS) {
      return { zone, productionDays: null, marginDays: null, fallback: false, date: null, reason: 'out_of_bounds' }
    }
    slowestKnownProductionDays = Math.max(slowestKnownProductionDays, days)
  }

  const productionDays = Math.ceil(slowestKnownProductionDays)
  const marginDays = productionUnknown ? UNKNOWN_PRODUCTION_MARGIN_DAYS[zone] : TRANSIT_MARGIN_DAYS[zone]
  const date = workingDaysBetween(departureDay(now), { productionDays, marginDays })

  return {
    zone,
    productionDays: productionUnknown ? null : productionDays,
    marginDays,
    fallback: productionUnknown,
    date: dateKey(date),
    reason: 'ok',
  }
}

/** Esito di una stima non arrivata: il cliente deve confermare di proseguire senza data. */
export function deliveryEstimateAfterNetworkError(key: string) {
  return { key, date: null, productionDays: null, needsConfirmation: true as const }
}

export function formatDeliveryDate(locale: string, date: Date): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long',
  }).format(date)
}
