/**
 * Numero d'ordine e deep link Telegram: identita' del documento, non un orologio.
 *
 * PERCHE' ESISTE. Il numero d'ordine era `FOOLISH-${Date.now()}`: due clienti che
 * pagavano nello stesso millisecondo ricevevano lo stesso numero, il secondo
 * trovava l'ordine del primo (`findCmsOrder` e' idempotente per `orderNumber`)
 * e restava addebitato senza ordine. Il numero e' anche il riferimento che il
 * cliente legge e che il bot Telegram usa per collegare la chat.
 *
 * FORMA. `FOOLISH-` + 32 caratteri esadecimali (UUIDv4 senza trattini) = 40
 * caratteri, nessun componente temporale: 122 bit di casualita', non un contatore
 * che si puo' indovinare. Il limite del deep link Telegram e' 64 caratteri sul
 * parametro `start`, quindi 46 con il prefisso `order_`: c'e' margine, e i numeri
 * del flusso vecchio (`FOOLISH-cs_live_...`, ~74) non lo rispettano.
 */

export const ORDER_REF_PREFIX = 'FOOLISH-'

/** Caratteri esadecimali di un UUIDv4 senza trattini. */
export const ORDER_REF_HEX_LENGTH = 32

/** Lunghezza totale di un numero d'ordine generato qui. */
export const ORDER_REF_LENGTH = ORDER_REF_PREFIX.length + ORDER_REF_HEX_LENGTH

/** Solo la forma generata da `generateOrderRef`: minuscolo esadecimale, niente altro. */
const GENERATED_ORDER_REF_RE = /^FOOLISH-[0-9a-f]{32}$/

export const TELEGRAM_BOT_URL = 'https://t.me/the_foolish_butcher_bot'

/** Prefisso riconosciuto dal bot: `?start=order_<numero>`. */
export const TELEGRAM_ORDER_START_PREFIX = 'order_'

/** Telegram: il parametro `start` accetta al massimo 64 caratteri. Oltre, lo scarta in silenzio. */
export const TELEGRAM_START_MAX_LENGTH = 64

/**
 * Genera un numero d'ordine nuovo. Non usa il tempo: due chiamate nello stesso
 * millisecondo danno due numeri diversi, e il formato prodotto e' verificato
 * prima di uscire (un runtime rotto deve fallire qui, non scrivere un ordine
 * con un numero non univoco).
 */
export function generateOrderRef(): string {
  const hex = crypto.randomUUID().replace(/-/g, '')
  const orderRef = `${ORDER_REF_PREFIX}${hex}`
  if (!GENERATED_ORDER_REF_RE.test(orderRef)) {
    throw new Error(`numero d'ordine non conforme: ${hex.length} caratteri esadecimali`)
  }
  return orderRef
}

/** Vero solo per i numeri generati da questo modulo (forma stretta). */
export function isGeneratedOrderRef(value: unknown): value is string {
  return typeof value === 'string' && GENERATED_ORDER_REF_RE.test(value)
}

/**
 * Link alla chat del bot con il numero d'ordine nel parametro `start`.
 *
 * Quando il payload supera il limite Telegram si restituisce il link alla chat
 * senza parametro: un `start` troppo lungo viene scartato in silenzio e il
 * cliente finirebbe su una chat che non conosce il suo ordine, quindi e' meglio
 * un link che funziona meno uno che finge di funzionare. I numeri generati qui
 * (46 caratteri con il prefisso) sono sempre sotto il limite.
 */
export function telegramOrderLink(orderNumber: string | null | undefined): string {
  if (!orderNumber) return TELEGRAM_BOT_URL
  const payload = `${TELEGRAM_ORDER_START_PREFIX}${orderNumber}`
  if (payload.length > TELEGRAM_START_MAX_LENGTH) return TELEGRAM_BOT_URL
  return `${TELEGRAM_BOT_URL}?start=${encodeURIComponent(payload)}`
}
