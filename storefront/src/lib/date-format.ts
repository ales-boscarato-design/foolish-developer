import { MONEY_LOCALE_TAGS, normalizeMoneyLocale, type MoneyLocale } from './money'

/**
 * Le date che il lettore vede — formattate nella lingua della pagina, con i tag
 * espliciti che il negozio ha gia' deciso.
 *
 * Perche' questo file esiste: la pagina delle statistiche affiliate (letta da
 * persone che non sono clienti e non parlano italiano) costruiva il proprio
 * `Intl.DateTimeFormat` con il locale di ROUTING (`it`, `en`, …). Con la lingua
 * nuda la regione la sceglie CLDR (`en` -> `en-US`), e la pagina formattava con
 * una regola che nessun altro punto del sito aveva scelto: la stessa data poteva
 * leggersi in un modo qui e in un altro altrove, senza che nessun test se ne
 * accorgesse, perche' oggi le cinque lingue rendono uguale.
 *
 * I tag non si ricopiano: sono quelli di `money.ts` (`MONEY_LOCALE_TAGS`), che
 * possiede la decisione «la lingua non si deduce dal sistema» per tutto il
 * negozio. Una lingua aggiunta a `routing.locales` passa di li', non da una
 * seconda lista da ricordare.
 *
 * Il fuso orario NON si fissa: la resa resta quella di prima (l'istante
 * formattato nel fuso del server, come faceva la pagina). Fissarlo a UTC
 * sposterebbe di un giorno le date vicine alla mezzanotte, cioe' cambierebbe
 * quello che il lettore vede — una decisione di prodotto, non un refactor.
 */

const dateFormatters = new Map<MoneyLocale, Intl.DateTimeFormat>()

function dateFormatterFor(locale: MoneyLocale): Intl.DateTimeFormat {
  const cached = dateFormatters.get(locale)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat(MONEY_LOCALE_TAGS[locale], {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  dateFormatters.set(locale, formatter)
  return formatter
}

/**
 * `12 novembre 2026` in italiano, `12 November 2026` in inglese: la stessa data
 * nella lingua della pagina.
 *
 * Una data non valida e' un errore di programmazione, non un valore da
 * mostrare: `Intl` renderebbe `Invalid Date` in pagina (o, peggio, un testo che
 * sembra una data). Si ferma qui.
 */
export function formatLongDate(
  locale: string | null | undefined,
  value: string | number | Date,
): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`formatLongDate: data non valida (${String(value)})`)
  }
  return dateFormatterFor(normalizeMoneyLocale(locale)).format(date)
}
