import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

import { notifyNanobot } from '@/lib/nanobot'
import {
  resolvePrintfulShipping,
  type PrintfulRecipient,
  type ResolvedPrintfulShipping,
  type ShippingAddressSource,
} from '@/lib/printful-shipping'

export const dynamic = 'force-dynamic'

/**
 * Avviso operativo quando una riga merch non puo' essere stampata.
 *
 * Perche' esiste: la rotta risponde 200 anche quando l'ordine di stampa non
 * nasce, e deve continuare a rispondere 200 (Stripe rilancerebbe un webhook gia'
 * gestito e l'ordine nel CMS esiste comunque). Senza un avviso esplicito l'unica
 * traccia era un `console.warn`: un ordine merch poteva restare non stampato e
 * scoprirlo giorni dopo. Il canale e' lo stesso usato dalle altre segnalazioni
 * operative dello storefront (hook firmato al ricevitore, che consegna al topic).
 *
 * Contenuto: solo riferimenti e NOMI dei campi mancanti. Mai nome del cliente,
 * indirizzo, email o corpo della risposta di Printful (che puo' rimandare i dati
 * del destinatario): l'avviso serve a sapere che c'e' qualcosa da guardare.
 */
const FULFILLMENT_ALERT_HOOK = '/hooks/foolish-printful-fulfillment'

type FulfillmentAlertReason = 'indirizzo_incompleto' | 'printful_create_failed' | 'fulfillment_failed'

interface FulfillmentAlert {
  eventType: 'printful_fulfillment_alert'
  orderRef: string
  source?: ShippingAddressSource
  reason: FulfillmentAlertReason
  /** Nomi dei campi che Printful richiede e che l'indirizzo scelto non ha. */
  missingFields: string[]
  /** Stato HTTP restituito da Printful, quando ce n'e' uno. */
  printfulStatus?: number
}

/**
 * Campi che `createPrintfulOrder` invia e che Printful richiede.
 * `name` e' nell'elenco perche' la create lo manda e Printful lo pretende: senza,
 * un rifiuto 422 per destinatario senza nome arriverebbe con `missingFields: []`
 * e chi interviene non saprebbe cosa manca.
 */
function missingShippingFields(recipient: PrintfulRecipient): string[] {
  const required: Array<[string, string]> = [
    ['name', recipient.name],
    ['address1', recipient.address1],
    ['city', recipient.city],
    ['postalCode', recipient.postalCode],
    ['country', recipient.country],
  ]
  return required.filter(([, value]) => !value).map(([field]) => field)
}

async function alertFulfillmentIssue(alert: FulfillmentAlert): Promise<void> {
  try {
    // `throwOnError` perche' l'esito dell'invio deve finire nei log come errore
    // esplicito e non sparire dentro `notifyNanobot`; il timeout perche' un
    // canale di notifica appeso non deve tenere in vita il webhook Stripe (che
    // ritenterebbe un evento gia' consegnato).
    await notifyNanobot(FULFILLMENT_ALERT_HOOK, alert, {
      throwOnError: true,
      signal: AbortSignal.timeout(3000),
    })
  } catch (error) {
    // L'avviso non deve mai far fallire la rotta: l'ordine nel CMS esiste e
    // Stripe non deve ritentare per un canale di notifica irraggiungibile.
    console.error('[printful-webhook] avviso operativo non inviato:', error)
  }
}

interface ParsedItem {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
}

async function findPrintfulVariantForSku(sku: string): Promise<string | null> {
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
  const res = await fetch(
    `${cmsUrl}/api/products?where[section][equals]=merch&where[variants.sku][equals]=${encodeURIComponent(sku)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' } },
  )
  if (!res.ok) return null
  const data = await res.json()
  const product = data.docs?.[0] as { variants?: Array<{ sku: string; printfulSyncVariantId?: string }> } | undefined
  const variant = product?.variants?.find((v) => v.sku === sku)
  return variant?.printfulSyncVariantId ?? null
}

function printfulHeaders(): Record<string, string> {
  const apiKey = process.env.PRINTFUL_API_KEY
  if (!apiKey) throw new Error('PRINTFUL_API_KEY non configurata')
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

// Idempotenza: la documentazione pubblica Printful NON garantisce che un secondo
// POST /orders con lo stesso external_id venga deduplicato (potrebbe rifiutarlo
// con errore, oppure — non essendo questo comportamento documentato in modo
// esplicito — nel peggiore dei casi crearne uno nuovo). Un ordine di stampa
// duplicato è un costo reale e non recuperabile automaticamente (a differenza di
// un webhook CMS duplicato, che è un no-op idempotente), quindi qui NON ci
// affidiamo silenziosamente a external_id: verifichiamo esplicitamente presso
// Printful stesso se un ordine con questo external_id esiste già PRIMA di crearne
// uno nuovo (GET /orders/@{external_id} — Printful supporta il prefisso "@" per
// riferirsi a risorse tramite external_id, come documentato per Sync
// Product/Variant). Come ulteriore rete di sicurezza contro la finestra di razza
// check-then-create in caso di redelivery Stripe concorrenti, trattiamo anche un
// eventuale errore di "external_id duplicato" ritornato dalla create come segnale
// di "già fulfillato" invece che come fallimento.
async function printfulOrderAlreadyExists(orderRef: string): Promise<boolean> {
  const res = await fetch(`https://api.printful.com/orders/@${encodeURIComponent(orderRef)}`, {
    method: 'GET',
    headers: printfulHeaders(),
  })
  if (res.status === 404) return false
  if (res.ok) return true
  const text = await res.text()
  throw new Error(`Printful lookup order failed ${res.status}: ${text}`)
}

/** Errore della create Printful: il corpo della risposta resta fuori dall'avviso. */
class PrintfulCreateError extends Error {
  readonly status: number
  readonly detail: string

  constructor(status: number, detail: string) {
    super(`Printful create order failed ${status}`)
    this.name = 'PrintfulCreateError'
    this.status = status
    this.detail = detail
  }
}

async function createPrintfulOrder(params: {
  orderRef: string
  items: Array<{ variantId: string; quantity: number }>
  shipping: { name: string; address1: string; address2: string; city: string; postalCode: string; country: string }
}): Promise<void> {
  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: printfulHeaders(),
    body: JSON.stringify({
      external_id: params.orderRef,
      recipient: {
        name: params.shipping.name,
        address1: params.shipping.address1,
        address2: params.shipping.address2 || undefined,
        city: params.shipping.city,
        zip: params.shipping.postalCode,
        country_code: params.shipping.country,
      },
      items: params.items.map((i) => ({ sync_variant_id: Number(i.variantId), quantity: i.quantity })),
      confirm: true,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    // Rete di sicurezza: se Printful segnala che l'external_id è già in uso,
    // trattiamo la richiesta come già evasa (non un errore) — vedi nota di
    // idempotenza sopra sulla finestra di razza check-then-create.
    if (res.status === 409 || /external_id/i.test(text)) {
      console.warn(`[printful-webhook] Ordine ${params.orderRef} risulta già presente su Printful (create ha risposto ${res.status}): ${text}`)
      return
    }
    throw new PrintfulCreateError(res.status, text)
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_PRINTFUL_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_PRINTFUL_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('Printful fulfillment webhook signature invalid:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    // Le sessioni abbonamento non hanno righe merch (metadata plan/zone, non
    // items_json) — le escludiamo esplicitamente per chiarezza, stesso
    // controllo fatto per primo nel webhook principale.
    if (session.mode === 'subscription') {
      return NextResponse.json({ received: true })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }

    // Dichiarato fuori dal `try`: se qualcosa esplode dopo che l'indirizzo e'
    // stato risolto, l'avviso d'errore deve poter dire quale fonte e' stata
    // scelta e quali campi mancavano — senza, un errore generico cancella la
    // causa piu' probabile.
    let resolvedShipping: ResolvedPrintfulShipping | null = null

    try {
      const meta = session.metadata ?? {}
      const orderRef = meta.order_ref ?? `FOOLISH-${session.id}`

      let parsedItems: ParsedItem[] = []
      try {
        parsedItems = JSON.parse(meta.items_json ?? '[]')
      } catch {
        return NextResponse.json({ received: true })
      }

      const merchItems: Array<{ variantId: string; quantity: number }> = []
      for (const item of parsedItems) {
        const variantId = await findPrintfulVariantForSku(item.sku)
        if (variantId) merchItems.push({ variantId, quantity: item.qty })
      }

      if (merchItems.length === 0) {
        return NextResponse.json({ received: true }) // nessuna riga merch in questo ordine
      }

      if (await printfulOrderAlreadyExists(orderRef)) {
        console.log(`[printful-webhook] Ordine Printful già esistente per ${orderRef}, skip (redelivery Stripe)`)
        return NextResponse.json({ received: true })
      }

      const customerName = meta.customer_name ?? session.customer_details?.name ?? ''

      // L'indirizzo vive in `collected_information.shipping_details` (campo che
      // l'API Stripe popola oggi); `shipping_details` di primo livello resta come
      // fonte per le sessioni vecchie e i metadata come ultimo ripiego. Vedi
      // `@/lib/printful-shipping`: leggere solo il campo legacy significava
      // spedire sempre all'indirizzo dei metadata, cioe' a quello del PRIMO
      // ordine quando il cliente rifa' un ordine con un indirizzo nuovo.
      resolvedShipping = resolvePrintfulShipping({
        session,
        customerName,
        // Solo le due chiavi che il resolver usa, lette qui dal vivo: il gate
        // pre-deploy (`scripts/release-gate.mjs`, MONEY_PATH_READERS) attribuisce
        // a questo file i metadata monetari che consuma, e non vede una lettura
        // che avviene dentro un altro modulo.
        metadata: { customer_address: meta.customer_address, customer_country: meta.customer_country },
      })
      const { recipient: shipping, source: shippingSource, complete: shippingComplete } = resolvedShipping

      if (!shippingComplete) {
        // Meglio un ordine che Printful rifiuta (e che si tratta a mano) di un
        // pacco spedito a un indirizzo che il cliente non ha scritto. L'avviso
        // scatta per OGNI fonte: il fallback sui metadata e' proprio quello che
        // porta l'indirizzo del primo ordine nei riordini e negli ordini
        // storici, cioe' il caso in cui il problema e' piu' probabile.
        console.warn(
          `[printful-webhook] Indirizzo di spedizione incompleto da ${shippingSource} per ${orderRef}: verificare a mano prima della spedizione`,
        )
      }

      // Un solo avviso per ordine, emesso DOPO il tentativo: prima dell'esito
      // non si sa se il problema e' l'indirizzo o un rifiuto di Printful, e due
      // messaggi per lo stesso ordine (incompleto + rifiutato) dicono la stessa
      // cosa due volte. Emetterlo dopo tiene anche la latenza dell'avviso fuori
      // dal percorso che crea l'ordine di stampa.
      let printfulFailure: PrintfulCreateError | null = null
      try {
        await createPrintfulOrder({ orderRef, items: merchItems, shipping })
        console.log(`[printful-webhook] Ordine Printful creato per ${orderRef} (${merchItems.length} righe)`)
      } catch (createError) {
        if (!(createError instanceof PrintfulCreateError)) throw createError
        console.error('[printful-webhook] Printful create order failed:', `${createError.message} — ${createError.detail}`)
        printfulFailure = createError
      }

      if (printfulFailure || !shippingComplete) {
        await alertFulfillmentIssue({
          eventType: 'printful_fulfillment_alert',
          orderRef,
          source: shippingSource,
          reason: printfulFailure ? 'printful_create_failed' : 'indirizzo_incompleto',
          missingFields: missingShippingFields(shipping),
          ...(printfulFailure ? { printfulStatus: printfulFailure.status } : {}),
        })
      }
    } catch (err) {
      console.error('[printful-webhook] Fulfillment failed:', err)
      await alertFulfillmentIssue({
        eventType: 'printful_fulfillment_alert',
        orderRef: session.metadata?.order_ref ?? `FOOLISH-${session.id}`,
        ...(resolvedShipping ? { source: resolvedShipping.source } : {}),
        reason: 'fulfillment_failed',
        missingFields: resolvedShipping ? missingShippingFields(resolvedShipping.recipient) : [],
      })
    }
  }

  return NextResponse.json({ received: true })
}
