/**
 * Gli importi che il cliente legge — formattati nella lingua della pagina.
 *
 * Il difetto che questo file chiude (misurato il 12/11/2026 su build di
 * produzione, Chromium su `next start`): tutti gli importi del checkout erano
 * resi con `Number.prototype.toFixed(2)`, che produce sempre il punto come
 * separatore decimale. Su `/fr/checkout` la barra della soglia diceva
 * «Ajoutez 30.00€ pour la livraison gratuite», su `/it/checkout`
 * «Aggiungi 30.00€ per la spedizione gratuita»; subtotale `€99.00`, totale
 * `€106.65`, pulsante `Paga 106.65€`. Italiano, francese, spagnolo e tedesco
 * scrivono la virgola: la pagina parlava la lingua giusta con i numeri sbagliati.
 *
 * DUE DECISIONI, UNA SOLA FORMA
 *
 * 1. Il simbolo dell'euro sta FUORI dal valore formattato, dopo il numero e
 *    senza spazio: `30,00€`. Le frasi approvate in `messages/*.json` scrivono
 *    gia' `{amount}€` (`freeShippingAdd`, `labelFreeAbove`, `pay`) in tutte e
 *    cinque le lingue, e il testo di una traduzione non si scrive nel codice.
 *    Per questo `formatMoney()` restituisce il NUMERO e `formatEuro()` aggiunge
 *    il simbolo: chi passa l'importo a un messaggio usa `formatMoney` (il `€`
 *    e' gia' nella frase), chi lo mette in pagina da solo usa `formatEuro`.
 *    Con `style: 'currency'` il simbolo entrerebbe nel valore e le frasi
 *    dovrebbero perderlo — due forme per la stessa cosa, e la prima che
 *    sfugge produce `30,00€€`.
 *
 * 2. L'arrotondamento non introduce un numero nuovo, ma non e' nemmeno quello
 *    di `toFixed` — e la differenza va nella direzione giusta. `toFixed(2)`
 * 2. Le cifre mostrate sono ESATTAMENTE quelle di ieri: il numero passa da
 *    `amount.toFixed(2)` — l'arrotondamento che la pagina usava — e solo dopo
 *    dai separatori della lingua, rileggendo il decimale per non perdere il
 *    lavoro fatto (`Number(fixed)` e' esatto per qualunque valore a due
 *    decimali). Nessun centesimo si muove, ne' in piu' ne' in meno, e nessun
 *    prezzo, soglia, zona o sconto e' deciso qui: questo file riceve un numero
 *    in euro e lo rende leggibile.
 *
 *    Perche' non affidare l'arrotondamento a `Intl`: `Intl` arrotonda la
 *    rappresentazione decimale del double (`2.675` -> `2,68`) mentre `toFixed`
 *    la tronca al valore binario (`2.67`), e `Math.round(x * 100)` arrotonda i
 *    centesimi. Tre regole diverse per la stessa cifra, e la pagina non deve
 *    cambiare numero mentre cambia lingua: la regola resta quella che il
 *    cliente vedeva, i separatori diventano quelli giusti.
 *
 *    Resta fuori da qui, ed e' DICHIARATA nel PR, una divergenza preesistente
 *    fra il numero mostrato e quello addebitato sulle righe con `pack`: il
 *    carrello calcola il prezzo unitario scontato come double e arrotonda la
 *    RIGA, il server arrotonda l'UNITA' e poi moltiplica (`catalog.ts`,
 *    `promo.ts`). Misurato: 14 combinazioni su 30 divergono di 1-5 centesimi,
 *    identiche prima e dopo questa PR. Chiuderla vuol dire toccare il calcolo
 *    (fuori perimetro di questa card) o far portare `lineTotalCents` alle
 *    righe del carrello.
 */

/** Le lingue pubblicate dal negozio (`src/i18n/routing.ts`). */
export const MONEY_LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
export type MoneyLocale = (typeof MONEY_LOCALES)[number]

/** Locale pubblicata, o `it` (il default di routing) per un valore non previsto. */
export function normalizeMoneyLocale(locale: string | null | undefined): MoneyLocale {
  const base = String(locale ?? '').toLowerCase().split('-')[0]
  return (MONEY_LOCALES as readonly string[]).includes(base)
    ? (base as MoneyLocale)
    : 'it'
}

/** Il simbolo, uno solo in tutto il negozio: si compone, non si riscrive. */
export const EURO_SIGN = '€'

/**
 * Due decimali sempre, raggruppamento delle migliaia da mille in su in tutte e
 * cinque le lingue.
 *
 * `useGrouping: true` (che in ECMA-402 significa «sempre», non «automatico»)
 * non e' un dettaglio: il default CLDR italiano raggruppa solo da cinque cifre,
 * quindi `1234` resterebbe `1234,50` in italiano e diventerebbe `1,234.50` in
 * inglese. Lo stesso importo non deve cambiare forma cambiando pagina.
 */
const formatters = new Map<MoneyLocale, Intl.NumberFormat>()

function formatterFor(locale: MoneyLocale): Intl.NumberFormat {
  const cached = formatters.get(locale)
  if (cached) return cached
  const formatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
  formatters.set(locale, formatter)
  return formatter
}

/**
 * L'importo in euro come lo scrive quella lingua, senza simbolo: `30,00` in
 * it/fr/es/de, `30.00` in inglese, `1.234,50` sopra il migliaio.
 *
 * Le cifre vengono da `toFixed(2)` — la stessa regola che la pagina usava
 * prima di questa funzione — e solo i separatori cambiano: e' cosi' che
 * «nessun arrotondamento cambia» e' una proprieta' verificabile invece di una
 * promessa (il test la misura su un corpus, mezzi centesimi inclusi).
 *
 * Un valore non finito e' un errore di programmazione, non un prezzo: si
 * ferma qui invece di mostrare `0,00` (un numero inventato che nessuno
 * ricalcolerebbe) o `NaN` in pagina.
 */
export function formatMoney(locale: string | null | undefined, amount: number): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError(`formatMoney: importo non finito (${String(amount)})`)
  }
  // `Number('1234.56')` torna al double piu' vicino a quel decimale, quindi il
  // formattatore non puo' arrotondare diversamente: le cifre sono quelle.
  return formatterFor(normalizeMoneyLocale(locale)).format(Number(amount.toFixed(2)))
}

/** `30,00€` — il simbolo dopo il numero, senza spazio, come nelle frasi. */
export function formatEuro(locale: string | null | undefined, amount: number): string {
  return `${formatMoney(locale, amount)}${EURO_SIGN}`
}
