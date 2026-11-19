/**
 * Il badge «spedizione gratuita» — una promessa, un numero, nessuna copia.
 *
 * Il difetto che questo file chiude: il badge della home diceva «Gratis sopra
 * €60» in tutte e cinque le lingue, ed era testo scritto a mano nei
 * `messages/*.json`, mentre il codice applicava 50 all'Italia e 150 all'Unione
 * Europea (`FLAT_ZONE_CONFIG` in `shipping.ts`). Un cliente francese leggeva
 * «gratuito sopra 60» e a 60 pagava 14,99; un cliente italiano leggeva 60 e
 * pagava lo stesso 7,65, perche' la soglia vera era 50.
 *
 * Qui non c'e' nessun numero: la soglia si legge da `shipping.ts`, si formatta
 * per la lingua e si inietta nel testo attraverso il segnaposto `{amount}`.
 * Cambiare una tariffa in `shipping.ts` cambia il badge in tutte le lingue, e
 * non e' piu' possibile che i due diverg.
 *
 * Due promesse diverse, non una promessa sola tradotta:
 *
 *   IT / EU    soglia in euro sul valore merce, uguale per tutti i clienti
 *              della zona;
 *   EXTRA_EU   nessuna spedizione gratuita: il costo e' calcolato sulla
 *              destinazione e comprende dazi e IVA all'importazione. Il prezzo
 *              landed li INCLUDE (DDP), quindi il testo dice «inclusi» — non
 *              «dovuti alla consegna», che sarebbe una seconda promessa e
 *              quella non e' vera per un ordine gia' sdoganato.
 *
 * La zona del badge e' quella della lingua (la promessa che il visitatore sta
 * leggendo in home); al checkout il numero lo decide l'INDIRIZZO, e questo file
 * non interviene li': `freeShippingRemaining(cartTotal, country)` in
 * `shipping.ts` prende il paese e basta, quindi non puo' essere contraddetto
 * dalla lingua con cui il cliente ha aperto il sito.
 */

import { FLAT_ZONE_CONFIG, type ShippingZone } from './shipping'
import { formatWholeMoney } from './money'

/** Le lingue pubblicate dal negozio (`src/i18n/routing.ts`). */
export const FREE_SHIPPING_BADGE_LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
export type FreeShippingBadgeLocale = (typeof FREE_SHIPPING_BADGE_LOCALES)[number]

/**
 * La zona della promessa, per lingua.
 *
 * `it` promette l'Italia, che ha una tariffa sua; `en` promette il valore
 * generale dell'Unione Europea, che e' quello che vale per un indirizzo
 * europeo; `fr`, `es` e `de` promettono la stessa zona EU. Nessuna delle
 * cinque promette la spedizione gratuita extra-UE, perche' non esiste.
 */
export const BADGE_ZONE_BY_LOCALE: Record<FreeShippingBadgeLocale, 'IT' | 'EU'> = {
  it: 'IT',
  en: 'EU',
  fr: 'EU',
  es: 'EU',
  de: 'EU',
}

/** Locale pubblicata, o `it` (il default di routing) per un valore non previsto. */
export function normalizeBadgeLocale(locale: string): FreeShippingBadgeLocale {
  const base = String(locale ?? '').toLowerCase().split('-')[0]
  return (FREE_SHIPPING_BADGE_LOCALES as readonly string[]).includes(base)
    ? (base as FreeShippingBadgeLocale)
    : 'it'
}

/** La zona promessa dalla lingua (non dall'indirizzo: quella la decide il checkout). */
export function badgeZoneForLocale(locale: string): 'IT' | 'EU' {
  return BADGE_ZONE_BY_LOCALE[normalizeBadgeLocale(locale)]
}

/** Soglia di spedizione gratuita della zona, in euro, dall'unica fonte. */
export function freeShippingThresholdEuros(zone: 'IT' | 'EU'): number {
  return FLAT_ZONE_CONFIG[zone].freeAbove
}

/** Tariffa piatta della zona, in euro, dall'unica fonte (la usano i termini). */
export function flatShippingCostEuros(zone: 'IT' | 'EU'): number {
  return FLAT_ZONE_CONFIG[zone].cost
}

/**
 * Cosa mostrare nel badge: le chiavi del namespace `home.badges.freeShipping`
 * e l'importo (gia' formattato) da passare al segnaposto `{amount}`.
 *
 * Le chiavi sono restituite invece del testo perche' il testo deve restare nei
 * `messages/*.json` (una traduzione non si scrive nel codice) e perche' il
 * chiamante lo rende con next-intl, che e' l'unico che sa interpolare.
 *
 * L'importo lo formatta `money.ts`, non questo file: i separatori, i tag di
 * lingua espliciti (`MONEY_LOCALE_TAGS`: `it-IT`, `en-GB`, …) e il simbolo
 * appartengono a un'unica autorita'. Il file aveva un formattatore proprio
 * costruito sulla lingua nuda (`it`, `en`, …) invece che sui tag: la stessa
 * pagina di checkout finiva con due regole di formattazione, e non si vedeva
 * solo perche' le soglie sono intere e la lingua nuda oggi rende uguale. Con
 * una soglia decimale o una lingua nuova il badge avrebbe scritto i numeri con
 * una regola diversa dal resto della pagina.
 *
 * La guardia che impedisce il ritorno del difetto vive in
 * `free-shipping-badge.test.ts` e legge questo sorgente GREZZO, commenti
 * compresi: per questo qui non si nomina il tipo del formattatore nemmeno in
 * prosa. Un filtro che scarta le righe di commento sembra comodo, ma in TS una
 * riga di codice puo' iniziare con `*` (un metodo generatore) o con `//` dopo
 * una continuazione, e diventerebbe codice invisibile alla guardia.
 */
export type FreeShippingBadgeCopy = {
  titleKey: 'title' | 'titleExtraEu'
  bodyKey: 'body' | 'bodyExtraEu'
  /** importo formattato per il segnaposto; `null` quando non c'e' una soglia. */
  amount: string | null
}

export function freeShippingBadgeCopy(locale: string, zone: ShippingZone): FreeShippingBadgeCopy {
  if (zone === 'EXTRA_EU') {
    // Nessun importo: su extra-UE non esiste una soglia, e il testo non deve
    // nemmeno suggerirla.
    return { titleKey: 'titleExtraEu', bodyKey: 'bodyExtraEu', amount: null }
  }
  return {
    titleKey: 'title',
    bodyKey: 'body',
    // La soglia e' una promessa tonda (`60`, non `60,00`), e la scrive la stessa
    // autorita' degli altri importi del negozio.
    amount: formatWholeMoney(locale, freeShippingThresholdEuros(zone)),
  }
}

/** Il badge della home: la zona la decide la lingua con cui si sta leggendo. */
export function homeFreeShippingBadge(locale: string): FreeShippingBadgeCopy {
  return freeShippingBadgeCopy(locale, badgeZoneForLocale(locale))
}

/**
 * Il badge «dazi e IVA inclusi» del checkout descrive un PREZZO — quindi si
 * mostra solo dove quel prezzo esiste.
 *
 * Il difetto che questa guardia chiude (misurato su BR il 12/11/2026): per una
 * destinazione non quotabile la riga spedizione diceva «Da quotare» ma il badge
 * affermava «Dazi e IVA all'importazione inclusi nel prezzo di spedizione» e il
 * riepilogo mostrava comunque un totale. Una frase vera su CH (dove il prezzo
 * landed esiste, DDP) diventa falsa su un paese che si quota a mano: li' non
 * c'e' nessun prezzo che includa qualcosa.
 *
 * Le tre condizioni sono tutte necessarie e sono le stesse che il checkout usa
 * per decidere: zona extra-UE (fuori, la promessa e' la soglia), non gratuita
 * (una spedizione a 0 non "include" oneri), non da quotare (il prezzo non
 * esiste). Chi rende il badge chiede a questa funzione, non ricopia la
 * condizione: `checkout/page.tsx` la chiamava a mano con due terzi dei termini.
 */
export function checkoutImportDutiesBadgeVisible(args: {
  zone: ShippingZone
  isFree: boolean
  requiresQuote: boolean
}): boolean {
  if (args.zone !== 'EXTRA_EU') return false
  if (args.isFree) return false
  return !args.requiresQuote
}
