import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

import { notifyNanobot } from '@/lib/nanobot'
import { ORDER_REF_PREFIX } from '@/lib/order-ref'
import {
  resolvePrintfulShipping,
  type PrintfulRecipient,
  type ResolvedPrintfulShipping,
  type ShippingAddressSource,
} from '@/lib/printful-shipping'
import { findCmsOrder, findCmsOrderBySessionId, getSessionOrderRef } from '@/lib/stripe-orders'

export const dynamic = 'force-dynamic'

/**
 * Avviso operativo quando una riga merch non puo' essere stampata.
 *
 * Perche' esiste: per un errore DEFINITIVO la rotta risponde 200 (vedi la politica
 * di retry in `POST`: un ordine gia' registrato nel CMS, o un rifiuto di validazione
 * che il retry non cambierebbe, non deve far ritentare Stripe all'infinito). In quel
 * caso l'unica traccia sarebbe un `console.warn`: un ordine merch poteva restare non
 * stampato e scoprirlo giorni dopo. Il canale e' lo stesso usato dalle altre
 * segnalazioni operative dello storefront (hook firmato al ricevitore, che consegna
 * al topic).
 *
 * Contenuto: solo riferimenti, CODICI SKU e NOMI dei campi mancanti. Mai nome del
 * cliente, indirizzo, email o corpo della risposta di Printful (che puo' rimandare i
 * dati del destinatario): l'avviso serve a sapere che c'e' qualcosa da guardare.
 */
const FULFILLMENT_ALERT_HOOK = '/hooks/foolish-printful-fulfillment'

type FulfillmentAlertReason =
  | 'indirizzo_incompleto'
  | 'printful_create_failed'
  | 'fulfillment_failed'
  | 'order_ref_unresolved'

interface FulfillmentAlert {
  eventType: 'printful_fulfillment_alert'
  orderRef: string
  source?: ShippingAddressSource
  reason: FulfillmentAlertReason
  /** Nomi dei campi che Printful richiede e che l'indirizzo scelto non ha. */
  missingFields: string[]
  /** Codici SKU delle righe merch coinvolte: quali prodotti non sono partiti. */
  skus?: string[]
  /** Stato HTTP restituito da Printful, quando ce n'e' uno. */
  printfulStatus?: number
  /** Solo per `order_ref_unresolved`: la sessione Stripe senza numero d'ordine. */
  stripeSessionId?: string
  /** Solo per `order_ref_unresolved`: un pacco col riferimento legacy esiste gia'. */
  legacyPrintfulOrderExists?: boolean
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

/**
 * Un errore dell'API Printful, classificato per la politica di retry di Stripe.
 *
 * Perche' una classe e non `Error`: (a) il corpo della risposta di Printful puo'
 * rimandare il destinatario e non deve finire nell'avviso — qui resta in `detail`,
 * che non viene mai serializzato nel payload dell'hook; (b) "ritentare o no" va
 * deciso dallo STATUS e non dal testo dell'errore.
 *
 * Classificazione:
 * - `retryable: true`  -> nessuna risposta (`status: null`: rete, DNS, timeout),
 *   408, 429, 5xx. Sono i casi in cui la stampa puo' nascere al tentativo
 *   successivo, quindi la rotta risponde 503 e lascia ritentare Stripe.
 * - `retryable: false` -> 4xx di validazione (400, 401, 403, 422: indirizzo
 *   rifiutato, chiave sbagliata). Ritentare la stessa richiesta produce lo stesso
 *   rifiuto: la rotta avvisa e risponde 200, perche' tre giorni di retry su un
 *   ordine che nessuno guarda non lo stampano.
 */
class PrintfulApiError extends Error {
  readonly status: number | null
  readonly detail: string
  readonly retryable: boolean

  constructor(params: { status: number | null; detail: string }) {
    super(params.status === null ? 'Printful non ha risposto' : `Printful ha risposto ${params.status}`)
    this.name = 'PrintfulApiError'
    this.status = params.status
    this.detail = params.detail
    this.retryable =
      params.status === null || params.status === 408 || params.status === 429 || params.status >= 500
  }
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
  // Gli header si costruiscono FUORI dal try: una chiave API assente non e' un
  // errore di rete, e classificarla come tale la farebbe ritentare per giorni.
  const headers = printfulHeaders()
  let res: Response
  try {
    res = await fetch(`https://api.printful.com/orders/@${encodeURIComponent(orderRef)}`, {
      method: 'GET',
      headers,
    })
  } catch (cause) {
    throw new PrintfulApiError({ status: null, detail: `lookup: ${String(cause)}` })
  }
  if (res.status === 404) return false
  if (res.ok) return true
  const text = await res.text()
  throw new PrintfulApiError({ status: res.status, detail: `lookup order: ${text}` })
}

async function createPrintfulOrder(params: {
  orderRef: string
  items: Array<{ variantId: string; quantity: number }>
  shipping: { name: string; address1: string; address2: string; city: string; postalCode: string; country: string }
}): Promise<void> {
  const headers = printfulHeaders()
  let res: Response
  try {
    res = await fetch('https://api.printful.com/orders', {
      method: 'POST',
      headers,
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
  } catch (cause) {
    // `fetch` lancia prima di avere uno status: rete, DNS, timeout del socket. E' il
    // caso AMBIGUO per eccellenza — la POST puo' essere arrivata e la risposta no —
    // quindi si classifica retryable e chi chiama verifica `external_id` prima di
    // dichiarare fallita la stampa.
    throw new PrintfulApiError({ status: null, detail: `create: ${String(cause)}` })
  }
  if (!res.ok) {
    const text = await res.text()
    // Rete di sicurezza: se Printful segnala che l'external_id è già in uso,
    // trattiamo la richiesta come già evasa (non un errore) — vedi nota di
    // idempotenza sopra sulla finestra di razza check-then-create.
    if (res.status === 409 || /external_id/i.test(text)) {
      console.warn(`[printful-webhook] Ordine ${params.orderRef} risulta già presente su Printful (create ha risposto ${res.status}): ${text}`)
      return
    }
    throw new PrintfulApiError({ status: res.status, detail: text })
  }
}

/**
 * Il riferimento con cui identificare l'ordine di stampa, oppure `null` quando non
 * ne esiste uno.
 *
 * PERCHE' NON SI INVENTA PIU'. Il codice faceva `meta.order_ref ?? \`FOOLISH-${session.id}\``:
 * un riferimento che nessun ordine del CMS portava. La stampa partiva per un pagamento
 * che nel CMS non esisteva (e le email di tracking partono dall'ordine CMS), e la chiave
 * di deduplicazione sul lato Printful non coincideva con quella dell'ordine reale.
 *
 * Qui, quando il checkout non ha dichiarato un numero d'ordine, si cercano solo ordini
 * che ESISTONO: prima per la chiave di sessione (`stripeSessionId`, unica sull'ordine),
 * poi per il numero legacy `FOOLISH-<session.id>` che il codice vecchio scriveva. Sono
 * letture: nessun documento viene creato. `null` significa "non risolvibile" e chi chiama
 * si ferma.
 */
async function resolveOrderRefForSession(session: Stripe.Checkout.Session): Promise<string | null> {
  const declared = getSessionOrderRef(session)
  if (declared) return declared

  const bySession = await findCmsOrderBySessionId(session.id)
  if (bySession?.orderNumber) return bySession.orderNumber

  // Ordini creati prima di `stripeSessionId`: il numero e' `FOOLISH-<session.id>` e la
  // colonna di sessione e' vuota, quindi la chiave e' il numero stesso.
  const legacy = await findCmsOrder(`${ORDER_REF_PREFIX}${session.id}`)
  return legacy?.orderNumber ?? null
}

/**
 * Avviso operativo quando una riga merch resta senza un ordine di stampa perche' il
 * pagamento non dichiara (e non ha) un numero d'ordine.
 *
 * Il canale e' lo stesso delle altre segnalazioni operative dello storefront
 * (`alertFulfillmentIssue`), cosi' c'e' un punto solo che invia, con timeout e
 * log dell'errore. Contenuto: solo riferimenti, mai nome, indirizzo o email.
 */
async function alertOrderReferenceUnresolved(params: {
  orderRef: string
  stripeSessionId: string
  legacyPrintfulOrderExists: boolean
}): Promise<void> {
  await alertFulfillmentIssue({
    eventType: 'printful_fulfillment_alert',
    orderRef: params.orderRef,
    reason: 'order_ref_unresolved',
    missingFields: [],
    stripeSessionId: params.stripeSessionId,
    legacyPrintfulOrderExists: params.legacyPrintfulOrderExists,
  })
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
    // Riferimento per l'avviso: il numero DICHIARATO dal checkout (letto dai metadata,
    // nessuna chiamata), poi quello risolto sul CMS. Se nessuno dei due esiste resta
    // `null` e l'avviso nomina la SESSIONE, mai un numero d'ordine inventato.
    let resolvedOrderRef: string | null = getSessionOrderRef(session)

    try {
      const meta = session.metadata ?? {}

      let parsedItems: ParsedItem[] = []
      try {
        parsedItems = JSON.parse(meta.items_json ?? '[]')
      } catch {
        return NextResponse.json({ received: true })
      }

      const merchItems: Array<{ variantId: string; quantity: number }> = []
      // Gli SKU che finiscono davvero in stampa: servono all'avviso ("quali righe non
      // sono partite") e sono codici prodotto, non dati del cliente.
      const merchSkus: string[] = []
      for (const item of parsedItems) {
        const variantId = await findPrintfulVariantForSku(item.sku)
        if (variantId) {
          merchItems.push({ variantId, quantity: item.qty })
          merchSkus.push(item.sku)
        }
      }

      if (merchItems.length === 0) {
        return NextResponse.json({ received: true }) // nessuna riga merch in questo ordine
      }

      // Il riferimento si risolve SOLO dopo aver accertato che c'e' merce da stampare:
      // una sessione senza righe merch non deve produrre un allarme di riferimento.
      let orderRef: string | null
      try {
        orderRef = await resolveOrderRefForSession(session)
        resolvedOrderRef = orderRef
      } catch (err) {
        // Il CMS non risponde: non si conosce il riferimento e non si inventa. 503 perche'
        // l'errore e' transitorio e il retry di Stripe e' la strada giusta.
        console.error(`[printful-webhook] ORDER REF LOOKUP FAILED session=${session.id}:`, err)
        return NextResponse.json(
          { error: 'order_reference_lookup_failed', stripeSessionId: session.id },
          { status: 503 },
        )
      }

      if (orderRef === null) {
        // Deduplicazione dei pacchi gia' creati col riferimento inventato dal codice
        // vecchio (`FOOLISH-<session.id>`): si CERCA, non si crea. Se esiste, il pacco e'
        // partito e l'unica azione utile e' segnalarlo — non crearne un secondo.
        const legacyRef = `${ORDER_REF_PREFIX}${session.id}`
        let legacyPrintfulOrderExists = false
        try {
          legacyPrintfulOrderExists = await printfulOrderAlreadyExists(legacyRef)
        } catch (err) {
          console.error(`[printful-webhook] ORDER REF LOOKUP FAILED session=${session.id} legacyRef=${legacyRef}:`, err)
          return NextResponse.json(
            { error: 'order_reference_lookup_failed', stripeSessionId: session.id },
            { status: 503 },
          )
        }

        console.error(
          `[printful-webhook] ORDER REF UNRESOLVED session=${session.id}: nessun order_ref nei metadata e nessun ordine CMS per questa sessione. Nessun ordine di stampa creato.`
          + (legacyPrintfulOrderExists ? ` Ordine di stampa gia' presente col riferimento legacy ${legacyRef}.` : ''),
        )
        await alertOrderReferenceUnresolved({
          orderRef: legacyPrintfulOrderExists ? legacyRef : session.id,
          stripeSessionId: session.id,
          legacyPrintfulOrderExists,
        })

        if (legacyPrintfulOrderExists) {
          // Nulla da creare: il pacco esiste gia' e un retry non cambierebbe niente.
          return NextResponse.json({ received: true, legacyOrderRef: legacyRef })
        }
        // NON-2xx: l'evento resta visibile nella dashboard Stripe (e viene ritentato), invece
        // di sparire dentro un 200 con un ordine di stampa inventato.
        return NextResponse.json(
          { error: 'order_reference_unresolved', code: 'order_ref_unresolved', stripeSessionId: session.id },
          { status: 503 },
        )
      }

      // La verifica di esistenza e' una CHIAMATA a Printful: puo' fallire anche quando
      // la create sarebbe andata bene. Senza un ramo esplicito l'errore finiva nel catch
      // generico (200 + "fulfillment_failed") e l'ordine pagato restava senza stampa e
      // senza retry. Qui si distingue: retryable -> 503 (Stripe riconsegna l'evento e la
      // verifica viene rifatta), permanente -> avviso e 200.
      try {
        if (await printfulOrderAlreadyExists(orderRef)) {
          console.log(`[printful-webhook] Ordine Printful già esistente per ${orderRef}, skip (redelivery Stripe)`)
          return NextResponse.json({ received: true })
        }
      } catch (lookupError) {
        if (!(lookupError instanceof PrintfulApiError)) throw lookupError
        console.error(
          `[printful-webhook] PRINTFUL LOOKUP FAILED ${orderRef}:`,
          `${lookupError.message} — ${lookupError.detail}`,
        )
        await alertFulfillmentIssue({
          eventType: 'printful_fulfillment_alert',
          orderRef,
          reason: 'fulfillment_failed',
          missingFields: [],
          skus: merchSkus,
          ...(lookupError.status !== null ? { printfulStatus: lookupError.status } : {}),
        })
        if (lookupError.retryable) {
          return NextResponse.json(
            { error: 'printful_order_lookup_failed', code: 'printful_order_lookup_retryable', orderRef },
            { status: 503 },
          )
        }
        // 401/403 sulla chiave: nessun retry puo' rimediare, serve un intervento.
        return NextResponse.json({ received: true, code: 'printful_order_lookup_permanent', orderRef })
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
      let printfulFailure: PrintfulApiError | null = null
      try {
        await createPrintfulOrder({ orderRef, items: merchItems, shipping })
        console.log(`[printful-webhook] Ordine Printful creato per ${orderRef} (${merchItems.length} righe)`)
      } catch (createError) {
        if (!(createError instanceof PrintfulApiError)) throw createError
        console.error('[printful-webhook] Printful create order failed:', `${createError.message} — ${createError.detail}`)
        printfulFailure = createError
      }

      // DOPPIO INVIO: un timeout o un 5xx ambiguo possono significare che Printful ha
      // gia' creato l'ordine (la POST e' arrivata, la risposta no). Prima di dichiarare
      // fallita la stampa si CERCA l'ordine con lo stesso `external_id`; se c'e', il
      // pacco e' partito e un secondo invio sarebbe un secondo pacco a pagamento.
      // Non si ritenta la POST dentro questa richiesta: se l'ordine non c'e', si
      // risponde non-2xx ed e' Stripe a riconsegnare l'evento, cosi' lo stato resta
      // coerente per chi guarda.
      if (printfulFailure?.retryable) {
        try {
          if (await printfulOrderAlreadyExists(orderRef)) {
            console.log(
              `[printful-webhook] already_created_after_error ${orderRef}: la create ha risposto con errore`
              + ` (${printfulFailure.status ?? 'nessuna risposta'}) ma l'ordine di stampa esiste. Nessun nuovo invio.`,
            )
            printfulFailure = null
          }
        } catch (verifyError) {
          // Se anche la verifica fallisce non si sa se il pacco c'e': resta un
          // fallimento retryable, e il tentativo successivo rifa' la verifica PRIMA
          // di creare (la create non parte mai senza il controllo di esistenza).
          console.error(`[printful-webhook] VERIFY AFTER CREATE ERROR FAILED ${orderRef}:`, verifyError)
        }
      }

      if (printfulFailure || !shippingComplete) {
        await alertFulfillmentIssue({
          eventType: 'printful_fulfillment_alert',
          orderRef,
          source: shippingSource,
          reason: printfulFailure ? 'printful_create_failed' : 'indirizzo_incompleto',
          missingFields: missingShippingFields(shipping),
          skus: merchSkus,
          ...(printfulFailure && printfulFailure.status !== null ? { printfulStatus: printfulFailure.status } : {}),
        })
      }

      if (printfulFailure) {
        // Politica di retry (decisione, non dettaglio): un ordine PAGATO con la stampa
        // non partita va recuperato, e l'unico attore che ritenta e' Stripe.
        //  - retryable (5xx / timeout / rete): 503. Stripe riconsegna l'evento e il
        //    tentativo successivo rifa' prima la verifica `external_id`, quindi il
        //    caso ambiguo non produce un doppione.
        //  - permanente (4xx di validazione: indirizzo rifiutato, 422): 200 con un
        //    `code` esplicito. La stessa richiesta verrebbe rifiutata allo stesso modo
        //    per i tre giorni di retry di Stripe, che quindi non aggiungerebbe nulla;
        //    il caso resta visibile perche' l'avviso e' gia' partito sopra.
        if (printfulFailure.retryable) {
          return NextResponse.json(
            {
              error: 'printful_create_failed',
              code: 'printful_create_retryable',
              orderRef,
              ...(printfulFailure.status !== null ? { printfulStatus: printfulFailure.status } : {}),
            },
            { status: 503 },
          )
        }
        return NextResponse.json({
          received: true,
          code: 'printful_create_permanent',
          orderRef,
          ...(printfulFailure.status !== null ? { printfulStatus: printfulFailure.status } : {}),
        })
      }
    } catch (err) {
      console.error('[printful-webhook] Fulfillment failed:', err)
      await alertFulfillmentIssue({
        eventType: 'printful_fulfillment_alert',
        orderRef: resolvedOrderRef ?? session.id,
        ...(resolvedShipping ? { source: resolvedShipping.source } : {}),
        reason: 'fulfillment_failed',
        missingFields: resolvedShipping ? missingShippingFields(resolvedShipping.recipient) : [],
      })
    }
  }

  return NextResponse.json({ received: true })
}
