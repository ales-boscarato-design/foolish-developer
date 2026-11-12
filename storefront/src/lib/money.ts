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
 * TRE DECISIONI, UNA SOLA FORMA
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
 * 2. La lingua non si deduce dal sistema: ogni lingua pubblicata ha il suo
 *    locale esplicito (`MONEY_LOCALE_TAGS`: it -> `it-IT`, en -> `en-GB`,
 *    fr -> `fr-FR`, es -> `es-ES`, de -> `de-DE`) e si passa quello a `Intl`.
 *    `Intl.NumberFormat(undefined, ...)` prenderebbe la lingua della
 *    macchina, che in SSR e nel browser puo' essere diversa: due rese dello
 *    stesso prezzo, cioe' un hydration mismatch. Un tag esplicito toglie
 *    anche la dipendenza dalla regione di default che CLDR sceglie per una
 *    lingua nuda (`en` -> `en-US`, oggi innocuo per i numeri, domani no).
 *
 * 3. L'unita' di misura del TESTO sono i centesimi interi, come per Stripe.
 *    `formatMoneyCents(locale, cents)` e `formatEuroCents(locale, cents)`
 *    ricevono un intero e non arrotondano niente: `Intl` non decide mai una
 *    cifra. Chi parte da euro passa da `eurosToDisplayCents()`, l'unica
 *    conversione di questo file, che riproduce l'arrotondamento che la pagina
 *    usava prima (`toFixed(2)`, poi il decimale riletto esatto) — cosi' il
 *    numero mostrato ieri e oggi e' lo stesso, cambiano solo i separatori.
 *    Il verso opposto non esiste di proposito: non c'e' nessuna funzione che
 *    riporti una stringa formattata a numero, perche' `Number('1.234,56')` e'
 *    `NaN` e `Number('30,00')` pure. Il prezzo che si incassa nasce dai
 *    centesimi del calcolo (`cartSubtotalCents`, `allocateProductDiscount`,
 *    `calculateServerShippingCostCents`), non dal testo.
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

/**
 * La lingua pubblicata -> il locale che si passa a `Intl`. Non e' una lista di
 * comodo: e' la decisione 2, e il test la confronta con `routing.locales`
 * perche' una lingua aggiunta al negozio non resti senza tag.
 */
export const MONEY_LOCALE_TAGS: Readonly<Record<MoneyLocale, string>> = {
  it: 'it-IT',
  en: 'en-GB',
  fr: 'fr-FR',
  es: 'es-ES',
  de: 'de-DE',
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
  const formatter = new Intl.NumberFormat(MONEY_LOCALE_TAGS[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
  formatters.set(locale, formatter)
  return formatter
}

/**
 * L'unica conversione euro -> centesimi che serve al testo: riproduce
 * l'arrotondamento che la pagina mostrava ieri (`toFixed(2)`) e restituisce un
 * intero.
 *
 * Non e' `Math.round(amount * 100)`: sui doppi che non hanno due decimali
 * esatti le due regole divergono di un centesimo (`2.675` -> 267 qui, 268 con
 * `Math.round`) e il cliente vedrebbe un prezzo diverso da ieri. Il numero
 * addebitato lo decide il server con `moneyToCents` (`Math.round`), che resta
 * l'autorita' del pagamento: qui si decide solo cosa si scrive in pagina.
 *
 * Un valore non finito e' un errore di programmazione, non un prezzo: si ferma
 * qui invece di mostrare `0,00` (un numero inventato che nessuno
 * ricalcolerebbe) o `NaN` in pagina.
 */
export function eurosToDisplayCents(amount: number): number {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new TypeError(`eurosToDisplayCents: importo non finito (${String(amount)})`)
  }
  // `Number('1234.56')` torna al double piu' vicino a quel decimale, quindi il
  // formattatore non puo' arrotondare diversamente: le cifre sono quelle.
  const cents = Math.round(Number(amount.toFixed(2)) * 100)
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`eurosToDisplayCents: centesimi non interi (${String(cents)})`)
  }
  return cents
}

/**
 * L'importo in euro come lo scrive quella lingua, senza simbolo: `30,00` in
 * it/fr/es/de, `30.00` in inglese, `1.234,50` sopra il migliaio.
 *
 * Riceve centesimi INTERI e non arrotonda: `Intl` fa solo i separatori, cosi'
 * la cifra mostrata e quella contata sono la stessa. Un centesimo frazionario
 * e' un errore di programmazione e si ferma qui, invece di entrare in pagina
 * come un prezzo che nessuno ha calcolato.
 */
export function formatMoneyCents(locale: string | null | undefined, cents: number): string {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) {
    throw new TypeError(`formatMoneyCents: centesimi non interi (${String(cents)})`)
  }
  // Un intero diviso per 100 e' il doppio piu' vicino a quel decimale, quindi
  // `Intl` non puo' spostare la cifra: formatta i centesimi che ha ricevuto.
  return formatterFor(normalizeMoneyLocale(locale)).format(cents / 100)
}

/** `30,00€` — il simbolo dopo il numero, senza spazio, come nelle frasi. */
export function formatEuroCents(locale: string | null | undefined, cents: number): string {
  return `${formatMoneyCents(locale, cents)}${EURO_SIGN}`
}

/**
 * Come `formatMoneyCents`, partendo da un importo in euro che il carrello ha
 * gia' calcolato: la conversione passa da `eurosToDisplayCents`, quindi il
 * testo nasce comunque da centesimi interi.
 */
export function formatMoney(locale: string | null | undefined, amount: number): string {
  return formatMoneyCents(locale, eurosToDisplayCents(amount))
}

/** `30,00€` partendo da euro; equivalente a `formatEuroCents` sui centesimi. */
export function formatEuro(locale: string | null | undefined, amount: number): string {
  return formatEuroCents(locale, eurosToDisplayCents(amount))
}
