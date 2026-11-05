/**
 * Indirizzo di spedizione per l'ordine Printful.
 *
 * Perche' esiste come modulo a se': fino a ieri il webhook leggeva solo
 * `session.shipping_details`, campo che l'API Stripe non popola piu'
 * (l'indirizzo raccolto al checkout vive in `collected_information.shipping_details`).
 * Con quel campo sempre vuoto la rotta finiva SEMPRE sul fallback dei metadata,
 * che sul riordino portano l'indirizzo del *primo* ordine: il cliente inseriva un
 * indirizzo nuovo e il pacco partiva verso quello vecchio.
 *
 * Ordine delle fonti (la prima che contiene davvero un indirizzo vince):
 *   1. `collected_information.shipping_details` (API Stripe attuale)
 *   2. `shipping_details` di primo livello (sessioni create prima del passaggio)
 *   3. metadata `customer_address` / `customer_country` (checkout senza raccolta
 *      nativa dell'indirizzo, ordini storici)
 *
 * Regola non negoziabile: i campi NON si mescolano fra fonti. Se la fonte scelta
 * ha un indirizzo parziale, i campi mancanti restano vuoti e l'ordine va
 * trattato a mano; completarli con la fonte successiva significherebbe spedire un
 * pacco il cui destinatario non e' quello che il cliente ha scritto.
 */

export interface PrintfulRecipient {
  name: string
  address1: string
  address2: string
  city: string
  postalCode: string
  country: string
}

export interface ShippingAddressFields {
  line1?: string | null
  line2?: string | null
  city?: string | null
  postal_code?: string | null
  country?: string | null
}

export interface ShippingDetailsFields {
  /** Nome scritto nel form di spedizione Stripe: sul riordino e' quello nuovo. */
  name?: string | null
  address?: ShippingAddressFields | null
}

/**
 * Le sole porzioni di `Stripe.Checkout.Session` che questa funzione legge.
 * `shipping_details` di primo livello non esiste piu' nei tipi della SDK 22:
 * resta leggibile sulle sessioni vecchie, quindi lo dichiariamo qui invece di
 * castare la sessione a `any` (che spegnerebbe il controllo dei tipi su tutto
 * il resto della rotta).
 */
export interface SessionShippingSource {
  collected_information?: { shipping_details?: ShippingDetailsFields | null } | null
  shipping_details?: ShippingDetailsFields | null
}

export type ShippingAddressSource = 'collected_information' | 'legacy_shipping_details' | 'metadata'

export interface ResolvedPrintfulShipping {
  recipient: PrintfulRecipient
  source: ShippingAddressSource
  /** Tutti i campi che Printful richiede (`address1`, city, zip, country) sono valorizzati. */
  complete: boolean
}

function text(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Un indirizzo "c'e'" se almeno uno dei campi significativi e' valorizzato. */
function hasAddressData(address: ShippingAddressFields): boolean {
  return [address.line1, address.city, address.postal_code, address.country].some(
    (field) => text(field).length > 0,
  )
}

function recipientFromDetails(
  details: ShippingDetailsFields | null | undefined,
  name: string,
): PrintfulRecipient | null {
  const address = details?.address
  if (!address || !hasAddressData(address)) return null
  return {
    // Il nome del destinatario segue la stessa regola dell'indirizzo: se il
    // cliente ne ha scritto uno nuovo al checkout (spedizione a terzi, ufficio,
    // regalo), quello vince sul `customer_name` dei metadata, che sul riordino
    // e' ancora il nome del primo ordine.
    name: text(details?.name) || name,
    address1: text(address.line1),
    address2: text(address.line2),
    city: text(address.city),
    postalCode: text(address.postal_code),
    country: text(address.country).toUpperCase(),
  }
}

function recipientFromMetadata(
  metadata: Record<string, string | null | undefined> | null | undefined,
  name: string,
): PrintfulRecipient {
  // Formato scritto dal checkout: `address|city|postalCode`.
  const parts = text(metadata?.customer_address).split('|')
  return {
    name,
    address1: text(parts[0]),
    address2: '',
    city: text(parts[1]),
    postalCode: text(parts[2]),
    country: text(metadata?.customer_country).toUpperCase(),
  }
}

function isComplete(recipient: PrintfulRecipient): boolean {
  return Boolean(recipient.address1 && recipient.city && recipient.postalCode && recipient.country)
}

export function resolvePrintfulShipping(args: {
  session: SessionShippingSource
  metadata?: Record<string, string | null | undefined> | null
  customerName?: string | null
}): ResolvedPrintfulShipping {
  const name = text(args.customerName)

  const fromCollected = recipientFromDetails(args.session.collected_information?.shipping_details, name)
  if (fromCollected) {
    return { recipient: fromCollected, source: 'collected_information', complete: isComplete(fromCollected) }
  }

  const fromLegacy = recipientFromDetails(args.session.shipping_details, name)
  if (fromLegacy) {
    return { recipient: fromLegacy, source: 'legacy_shipping_details', complete: isComplete(fromLegacy) }
  }

  const fromMetadata = recipientFromMetadata(args.metadata, name)
  return { recipient: fromMetadata, source: 'metadata', complete: isComplete(fromMetadata) }
}
