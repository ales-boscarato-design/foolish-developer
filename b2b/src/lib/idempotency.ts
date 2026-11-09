/**
 * Chiave di idempotenza lato browser.
 *
 * La chiave identifica un *contenuto* di checkout, non un click: finche'
 * carrello e dati del documento restano gli stessi, un retry dopo un errore
 * di rete riusa la stessa chiave. Se il contenuto cambia, cambia anche la
 * chiave, cosi' non si riusa per errore l'ordine di un altro carrello.
 *
 * La fingerprint copre ORA tutti i campi del form che finiscono sul
 * documento CMS, non solo SKU/qty/prezzo + paese + email: una chiave che non
 * copre i dati di fatturazione riapre il difetto al primo retry corretto.
 * Chi corregge P.IVA, ragione sociale, SDI o un indirizzo deve ottenere una
 * chiave nuova (e quindi un ordine nuovo), non la conferma silenziosa di un
 * documento gia' inviato con i dati vecchi.
 *
 * La canonicalizzazione e' deterministica: trim() su tutti i campi, email in
 * minuscolo, P.IVA e paesi in maiuscolo. Assente, undefined e null valgono
 * stringa vuota. Nessuna aritmetica float: i valori che entrano nella
 * fingerprint sono quelli gia' inviati, non un totale ricalcolato.
 *
 * Modulo puro: nessun accesso diretto a `window`/`sessionStorage` (lo
 * storage e' iniettato), cosi' i test possono provarlo senza browser.
 */

export const IDEMPOTENCY_STORAGE_KEY = 'b2b_checkout_idem'

export interface IdempotencyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface FingerprintItem {
  variantSku: string
  qty: number
  unitPrice: number
}

/**
 * Tutti i campi di form che finiscono sul documento CMS. Restano opzionali
 * nel tipo perche' il chiamante puo' non averli ancora valorizzati; in quel
 * caso la canonicalizzazione li tratta come stringa vuota.
 */
export interface FingerprintForm {
  email?: string | null
  businessName?: string | null
  vatNumber?: string | null
  sdiCode?: string | null
  billingAddress1?: string | null
  billingCity?: string | null
  billingPostalCode?: string | null
  billingCountry?: string | null
  shippingName?: string | null
  shippingAddress1?: string | null
  shippingCity?: string | null
  shippingPostalCode?: string | null
  shippingCountry?: string | null
  notes?: string | null
}

/**
 * Ordine fisso: cambiarlo cambia tutte le fingerprint gia' salvate nei
 * browser, quindi e' parte del contratto, non un dettaglio interno.
 */
export const DOCUMENT_FORM_FIELDS = [
  'email',
  'businessName',
  'vatNumber',
  'sdiCode',
  'billingAddress1',
  'billingCity',
  'billingPostalCode',
  'billingCountry',
  'shippingName',
  'shippingAddress1',
  'shippingCity',
  'shippingPostalCode',
  'shippingCountry',
  'notes',
] as const

export type DocumentFormField = typeof DOCUMENT_FORM_FIELDS[number]

const UPPERCASE_FIELDS = new Set<DocumentFormField>(['vatNumber', 'billingCountry', 'shippingCountry'])

/**
 * Regola unica di canonicalizzazione, condivisa con il confronto del
 * documento esistente (`orderDocumentIdentity`): se le due regole
 * divergessero, un retry legittimo produrrebbe un 409 falso.
 */
export function canonicalDocumentField(
  field: DocumentFormField,
  value: string | null | undefined,
): string {
  const trimmed = (value ?? '').trim()
  if (field === 'email') return trimmed.toLowerCase()
  if (UPPERCASE_FIELDS.has(field)) return trimmed.toUpperCase()
  return trimmed
}

/** Tutti i campi del documento, gia' canonicalizzati, in ordine fisso. */
export function canonicalDocumentForm(form: FingerprintForm): Record<DocumentFormField, string> {
  const canonical = {} as Record<DocumentFormField, string>
  for (const field of DOCUMENT_FORM_FIELDS) {
    canonical[field] = canonicalDocumentField(field, form[field])
  }
  return canonical
}

/**
 * Nessun totale calcolato qui: niente aritmetica float che possa produrre
 * una fingerprint diversa per lo stesso carrello. Si confrontano le righe
 * (SKU, qty, prezzo unitario) e tutti i campi del documento.
 */
export function cartFingerprint(items: FingerprintItem[], form: FingerprintForm): string {
  const lines = [...items]
    .sort((a, b) => (a.variantSku < b.variantSku ? -1 : a.variantSku > b.variantSku ? 1 : 0))
    .map((item) => `${item.variantSku}|${item.qty}|${item.unitPrice}`)
  const canonical = canonicalDocumentForm(form)
  const formLines = DOCUMENT_FORM_FIELDS.map((field) => `${field}|${JSON.stringify(canonical[field])}`)
  return [...lines, ...formLines].join(',')
}

type KeyGenerator = () => string

function defaultKeyGenerator(): string {
  return globalThis.crypto.randomUUID()
}

export function getOrCreateIdempotencyKey(
  fingerprint: string,
  storage: IdempotencyStorage,
  generateKey: KeyGenerator = defaultKeyGenerator,
): string {
  const raw = storage.getItem(IDEMPOTENCY_STORAGE_KEY)
  if (raw) {
    try {
      const saved = JSON.parse(raw) as { fingerprint?: unknown; key?: unknown }
      if (saved.fingerprint === fingerprint && typeof saved.key === 'string' && saved.key.length > 0) {
        return saved.key
      }
    } catch {
      // Storage corrotto: si rigenera invece di bloccare il checkout.
    }
  }

  const key = generateKey()
  storage.setItem(IDEMPOTENCY_STORAGE_KEY, JSON.stringify({ fingerprint, key }))
  return key
}
