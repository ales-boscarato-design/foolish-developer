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
 *    `undefined` prenderebbe la lingua della macchina, che in SSR e nel browser
 *    puo' essere diversa: due rese dello stesso prezzo, cioe' un hydration
 *    mismatch. Un tag esplicito toglie anche la dipendenza dalla regione di
 *    default che CLDR sceglie per una lingua nuda (`en` -> `en-US`, oggi
 *    innocuo per i numeri, domani no).
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
 * La stessa lingua, senza decimali: serve a un importo che e' una promessa
 * tonda (`60`, `150`), non a un prezzo.
 *
 * Perche' non riusare `formatterFor` e togliere `,00` dalla stringa: la stringa
 * formattata dipende dal locale (`60,00` / `60.00`) e ritagliarla a mano
 * significa ri-analizzare un formato che questo file produce: la prima lingua
 * con un formato diverso (arabo, indiano, un separatore di gruppo) romperebbe
 * il taglio senza che nessun test se ne accorga. Il tag resta lo stesso
 * (`MONEY_LOCALE_TAGS`), cambia solo quante cifre dopo la virgola si scrivono.
 */
const wholeFormatters = new Map<MoneyLocale, Intl.NumberFormat>()

function wholeFormatterFor(locale: MoneyLocale): Intl.NumberFormat {
  const cached = wholeFormatters.get(locale)
  if (cached) return cached
  const formatter = new Intl.NumberFormat(MONEY_LOCALE_TAGS[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true,
  })
  wholeFormatters.set(locale, formatter)
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

/**
 * Un importo TONDO in euro come lo scrive quella lingua: `60`, `150`, `1.234`
 * in italiano (il raggruppamento e' quello di `MONEY_LOCALE_TAGS`, non quello
 * del sistema).
 *
 * Serve alla soglia della spedizione gratuita: la frase approvata dice «Gratis
 * sopra 60€», e `60,00€` non e' quella frase. La soglia resta un importo in
 * euro e non un prezzo a listino, quindi il formato a due decimali non le
 * appartiene — ma i separatori (e la lingua) sono gli stessi del resto della
 * pagina, perche' li decide questo file e nessun altro.
 *
 * Un importo con centesimi e' un errore di programmazione e si ferma qui
 * (fail-closed): arrotondarlo a un euro intero scriverebbe in pagina una
 * promessa diversa da quella del codice (`59,90` diventerebbe «gratis sopra
 * 60»). Le soglie non sono dati di CMS ma costanti di codice
 * (`FLAT_ZONE_CONFIG` in `shipping.ts`), quindi un valore frazionario richiede
 * un commit, e i test che pinnano l'interezza delle soglie
 * (`shipping.test.ts` sui valori di zona, `free-shipping-badge.test.ts` sulla
 * soglia che il badge promette) lo fermano prima del deploy: la pagina non puo'
 * cadere in produzione per un valore che solo una modifica al codice puo'
 * introdurre. Chi ha importi con centesimi usa `formatMoney`.
 */
export function formatWholeMoney(locale: string | null | undefined, amount: number): string {
  // `eurosToDisplayCents` arrotonderebbe ai centesimi (`59.999` -> `60,00`) e
  // poi `Intl` arrotonderebbe ancora: qui la promessa e' «niente
  // arrotondamenti», quindi si controlla il valore in ingresso. `isSafeInteger`
  // copre in un colpo i non-numeri, i non finiti, i frazionari e i valori che
  // non sono rappresentabili esattamente (2**53), invece di lasciarli arrivare
  // a un errore di centesimi che non spiega niente.
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new TypeError(`formatWholeMoney: importo non intero (${String(amount)})`)
  }
  return wholeFormatterFor(normalizeMoneyLocale(locale)).format(eurosToDisplayCents(amount) / 100)
}

// -------------------------------------------------------------- percentuali

/** Il segno di percentuale, uno solo in tutto il negozio: si compone, non si riscrive. */
export const PERCENT_SIGN = '%'

/**
 * Le aliquote di commissione del programma affiliati arrivano in PUNTI BASE
 * interi (`currentRateBps`, `commissionBaseRateBps`): 500 punti base sono il
 * 5%, 1250 il 12,5%, 333 il 3,33%. Come per gli importi, l'unita' del testo e'
 * un intero e non un decimale gia' scritto: 1/100 di punto base non esiste, e
 * un valore frazionario e' un errore di programmazione che si ferma qui.
 *
 * Perche' una funzione qui e non nella pagina: la pagina delle statistiche
 * costruiva il proprio formattatore con la lingua nuda (`it`, `en`, …) invece
 * dei tag espliciti di `MONEY_LOCALE_TAGS`. Due formattatori nella stessa
 * pagina non si vedevano finche' la lingua nuda e il tag rendono uguale; la
 * deriva si sarebbe vista con una lingua nuova in `routing.locales` o con una
 * regola CLDR diversa per una lingua senza regione (`en` -> `en-US`).
 *
 * Il segno sta FUORI dal valore formattato e attaccato al numero, come l'euro
 * (`12,5%`): `style: 'percent'` lo metterebbe dentro con lo spazio che decide
 * il locale, e una frase che lo scrive gia' produrrebbe `12,5 % %`.
 */
const percentFormatters = new Map<MoneyLocale, Intl.NumberFormat>()

function percentFormatterFor(locale: MoneyLocale): Intl.NumberFormat {
  const cached = percentFormatters.get(locale)
  if (cached) return cached
  const formatter = new Intl.NumberFormat(MONEY_LOCALE_TAGS[locale], {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
    useGrouping: true,
  })
  percentFormatters.set(locale, formatter)
  return formatter
}

/**
 * `12,5%` in it/fr/es/de, `12.5%` in inglese: due decimali solo se servono
 * (`5%`, non `5,00%`), raggruppamento e separatori quelli della lingua.
 *
 * Un punto base frazionario e' un errore di programmazione, non un'aliquota:
 * `Intl` non deve decidere una cifra che il calcolo non ha prodotto.
 */
export function formatPercentBps(locale: string | null | undefined, bps: number): string {
  if (typeof bps !== 'number' || !Number.isSafeInteger(bps)) {
    throw new TypeError(`formatPercentBps: punti base non interi (${String(bps)})`)
  }
  return `${percentFormatterFor(normalizeMoneyLocale(locale)).format(bps / 100)}${PERCENT_SIGN}`
}
