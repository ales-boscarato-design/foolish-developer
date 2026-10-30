import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'

import type { B2BSession } from './auth'
import { getServerSession } from './auth'
import { createB2BUser, ensureB2BAuthTable, findB2BUserByEmail } from './db-auth'
import { createB2BOrder, type B2BPaymentMethod, type CmsOrder } from './cms-orders'
import { fetchResellerCatalog, type ResellerProduct } from './cms'
import { resolveAuthoritativeLines, type ResolvedLine } from './b2b-pricing'
import { calculateResellerShipping, shippingQuoteNote, type ResellerShippingResult } from './shipping'
import { createOrderPaymentIntent, realStripeIntentDeps } from './stripe-intents'
import { checkVatNumber, type ViesResult } from './vies'
import {
  canonicalDocumentField,
  canonicalDocumentForm,
  type DocumentFormField,
  type FingerprintForm,
} from './idempotency'

/**
 * Logica condivisa delle due rotte di checkout B2B (bonifico e Stripe).
 *
 * Perche' e' un modulo e non direttamente la rotta: le due rotte restano
 * fili di due righe, ma la logica (quella che i test devono esercitare per
 * intero) vive qui. Catalogo e ordine NON sono iniettati: sono le due cose
 * che i test di rotta devono provare davvero, e passano dal vero HTTP verso
 * il CMS. Le dipendenze esterne non-HTTP (sessione, VIES, Stripe, anagrafica
 * ospite) restano iniettabili per i test unitari del modulo.
 */

export interface CheckoutDeps {
  getServerSession: (req?: Request) => Promise<B2BSession | null>
  checkVatNumber: (vat: string) => Promise<ViesResult>
  ensureB2BAccount: (email: string, businessName: string) => Promise<void>
  createPaymentIntent: (args: {
    amountCents: number
    orderId: string | number
    orderNumber: string
    resellerEmail: string
  }) => Promise<{ client_secret: string | null }>
}

/** Il blocco ospite di sempre: anagrafica creata dall'ordine, mai bloccante. */
export async function ensureGuestB2BAccount(email: string, businessName: string): Promise<void> {
  try {
    await ensureB2BAuthTable()
    const existing = await findB2BUserByEmail(email)
    if (!existing) {
      await createB2BUser(email, businessName, null)
    }
  } catch (err) {
    // Un ordine valido non si perde perché non siamo riusciti a
    // creare l'anagrafica: l'ordine viene comunque registrato.
    console.error('[b2b-checkout] creazione account ospite fallita:', err)
  }
}

export const realCheckoutDeps: CheckoutDeps = {
  getServerSession,
  checkVatNumber,
  ensureB2BAccount: ensureGuestB2BAccount,
  createPaymentIntent: (args) => createOrderPaymentIntent(args, realStripeIntentDeps()),
}

/**
 * Numero d'ordine deterministico: stessa richiesta (email, chiave, righe,
 * totale) -> stesso numero, anche a distanza di giorni o dopo un riavvio.
 *
 * Niente data e niente prefisso AA MM: un retry che attraversa la mezzanotte
 * del cambio mese creerebbe un secondo ordine, che e' esattamente il caso da
 * chiudere. Il CMS ha `orderNumber` unico e Stripe riceve lo stesso numero
 * come chiave di idempotenza: entrambi i livelli riconoscono il ritorno.
 */
export function orderNumberFor(args: {
  email: string
  idempotencyKey: string
  lines: ResolvedLine[]
  totalCents: number
}): string {
  const linesFingerprint = args.lines
    .map((line) => `${line.variantSku}|${line.qty}|${line.unitPrice}|${line.lineTotalCents}`)
    .join(',')
  const digest = createHash('sha256')
    .update(`${args.email}:${args.idempotencyKey}:${linesFingerprint}:${args.totalCents}`)
    .digest('hex')
  return `B2B-${digest.slice(0, 12).toUpperCase()}`
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]+$/

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 128
    && IDEMPOTENCY_KEY_RE.test(value)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CheckoutForm = Record<string, any>

interface CheckoutContext {
  form: CheckoutForm
  session: B2BSession | null
  email: string
  idempotencyKey: string
  vat: ViesResult
  lines: ResolvedLine[]
  productsTotalCents: number
}

type PreflightResult = { ok: true; ctx: CheckoutContext } | { ok: false; response: Response }

function errorResponse(status: number, error: string): Response {
  // Il corpo non porta mai dettagli interni (riga, prezzo atteso, risposta
  // CMS/VIES): quelli restano nei log del server.
  return NextResponse.json({ error }, { status })
}

const STRING_FORM_FIELDS = [
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

/**
 * I campi stringa del form, normalizzati prima di ogni uso. Assente, null e
 * undefined valgono stringa vuota; qualunque altro tipo e' un rifiuto, non
 * una coercizione: `5` non e' un'email e un oggetto non e' una nota.
 */
function normalizeForm(form: Record<string, unknown>): CheckoutForm | null {
  const normalized: CheckoutForm = {}
  for (const field of STRING_FORM_FIELDS) {
    const raw = form[field]
    if (raw === undefined || raw === null) {
      normalized[field] = ''
    } else if (typeof raw === 'string') {
      normalized[field] = raw
    } else {
      return null
    }
  }
  return normalized
}

/**
 * I primi passi delle due rotte, nell'ordine deciso: sessione, body,
 * email/ragione sociale, VIES, risoluzione del carrello contro il catalogo.
 * Ogni rifiuto ferma la richiesta prima di qualunque scrittura: nessun
 * ordine e nessuna PaymentIntent per un carrello non autorevole o per un
 * catalogo che non si riesce a leggere.
 *
 * Il carrello che arriva dal browser porta SKU, prezzo e fasce copiati dal
 * catalogo quando il cliente lo ha riempito. Qui non si crede a quei valori:
 * si rileggono dal CMS (freschi), si confrontano, e se divergono si rifiuta
 * invece di ricalcolare in silenzio un totale che il cliente non ha visto.
 */
async function preflight(req: Request, deps: CheckoutDeps): Promise<PreflightResult> {
  const session = await deps.getServerSession(req)

  let body: { form?: CheckoutForm; items?: unknown; idempotencyKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return { ok: false, response: errorResponse(400, 'body_non_valido') }
  }

  const rawForm: unknown = body?.form
  if (rawForm !== undefined && (typeof rawForm !== 'object' || rawForm === null || Array.isArray(rawForm))) {
    return { ok: false, response: errorResponse(400, 'campo_non_valido') }
  }
  const form = normalizeForm((rawForm ?? {}) as Record<string, unknown>)
  if (!form) {
    return { ok: false, response: errorResponse(400, 'campo_non_valido') }
  }
  const items: unknown = body?.items

  // La chiave si valida subito dopo il body e il form, prima di VIES e
  // catalogo: una richiesta senza chiave non deve toccare servizi esterni.
  const idempotencyKey: unknown = body?.idempotencyKey
  if (!validIdempotencyKey(idempotencyKey)) {
    return { ok: false, response: errorResponse(400, 'chiave_idempotenza_mancante') }
  }

  const email = (session?.email ?? form.email ?? '').toLowerCase().trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, response: errorResponse(400, 'email_non_valida') }
  }
  if (!form.businessName.trim()) {
    return { ok: false, response: errorResponse(400, 'ragione_sociale_mancante') }
  }

  // Partita IVA: `invalid` ferma l'ordine, `unverified` no.
  // VIES è un servizio pubblico che cade a rotazione per singolo Stato
  // membro. Rifiutare chi sta pagando perché un'API governativa è giù
  // costa una vendita vera; accettare una partita IVA non verificata
  // costa un controllo manuale. Si sceglie il costo minore, e si lascia
  // la traccia perché il controllo avvenga davvero.
  const vat = await deps.checkVatNumber(form.vatNumber)
  if (vat.status === 'invalid') {
    return { ok: false, response: errorResponse(400, 'partita_iva_non_valida') }
  }

  let catalog: ResellerProduct[]
  try {
    catalog = await fetchResellerCatalog()
  } catch (err) {
    // La lettura e' fallita, e' andata in timeout o il catalogo e' troncato:
    // senza catalogo non si puo' dire se il prezzo e' giusto, quindi non si
    // vende.
    console.error('[b2b-checkout] catalogo non disponibile:', err)
    return { ok: false, response: errorResponse(503, 'catalogo_non_disponibile') }
  }

  const resolved = resolveAuthoritativeLines(items, catalog)
  if (!resolved.ok) {
    // Il dettaglio (riga, codice) resta nei log del server: al client basta
    // il codice, e la risposta non dice mai quale sarebbe il prezzo giusto.
    console.error('[b2b-checkout] carrello non autoritativo:', resolved.error, resolved.detail ?? '')
    return { ok: false, response: errorResponse(resolved.status, resolved.error) }
  }

  return {
    ok: true,
    ctx: {
      form,
      session,
      email,
      idempotencyKey,
      vat,
      lines: resolved.lines,
      productsTotalCents: resolved.productsTotalCents,
    },
  }
}

/** Traccia dell'esito VIES sull'ordine: la vede chi prepara la spedizione. */
function vatNote(vat: ViesResult): string {
  return vat.status === 'valid'
    ? `[VIES OK] ${vat.name ?? 'partita IVA valida'}${vat.address ? ' — ' + vat.address : ''}`
    : `[VIES NON VERIFICATA — controllare a mano] ${vat.detail ?? ''}`
}

function orderNotes(form: CheckoutForm, vat: ViesResult, mode: ResellerShippingResult['mode']): string {
  return [form.notes?.trim(), vatNote(vat), shippingQuoteNote(mode)].filter(Boolean).join('\n')
}

/**
 * I valori attesi per il documento CMS, gia' canonicalizzati con la stessa
 * regola della fingerprint (`idempotency.ts`). E' una funzione pura e
 * esportata perche' il confronto e' la parte che il test deve poter provare
 * senza passare da una richiesta HTTP.
 */
export interface OrderDocumentIdentity {
  customerEmail: string
  customerName: string
  billingCompanyName: string
  billingVatNumber: string
  billingSdiCode: string
  billingAddress: {
    address1: string
    city: string
    postalCode: string
    country: string
  }
  shippingAddress: {
    name: string
    address1: string
    city: string
    postalCode: string
    country: string
  }
}

export function orderDocumentIdentity(form: FingerprintForm, email: string): OrderDocumentIdentity {
  const canonical = canonicalDocumentForm(form)
  return {
    customerEmail: canonicalDocumentField('email', email),
    customerName: canonical.shippingName,
    billingCompanyName: canonical.businessName,
    billingVatNumber: canonical.vatNumber,
    billingSdiCode: canonical.sdiCode,
    billingAddress: {
      address1: canonical.billingAddress1,
      city: canonical.billingCity,
      postalCode: canonical.billingPostalCode,
      country: canonical.billingCountry,
    },
    shippingAddress: {
      name: canonical.shippingName,
      address1: canonical.shippingAddress1,
      city: canonical.shippingCity,
      postalCode: canonical.shippingPostalCode,
      country: canonical.shippingCountry,
    },
  }
}

/**
 * Il documento CMS porta piu' campi di quelli dichiarati in `CmsOrder`
 * (che e' il contratto minimo usato dal resto del codice). Qui si tipizzano
 * solo i campi che il confronto deve leggere, senza toccare `cms-orders.ts`.
 */
type CmsAddressDocument = {
  name?: unknown
  address1?: unknown
  city?: unknown
  postalCode?: unknown
  country?: unknown
}

type CmsOrderDocument = CmsOrder & {
  customerName?: unknown
  billingCompanyName?: unknown
  billingVatNumber?: unknown
  billingSdiCode?: unknown
  billingAddress?: CmsAddressDocument
  shippingAddress?: CmsAddressDocument
  paymentMethod?: unknown
  notes?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Confronto fail-closed di un campo: assente, null o non stringa non sono
 * mai un match. L'unica eccezione voluta e' `billingSdiCode` (documento
 * storico senza SDI), gestita esplicitamente sotto.
 */
function documentFieldMatches(
  field: DocumentFormField,
  actual: unknown,
  expected: string,
): boolean {
  return typeof actual === 'string' && canonicalDocumentField(field, actual) === expected
}

/**
 * Le righe di nota generate dal server non fanno parte dell'identita' del
 * cliente: VIES e nota di quotazione vengono ricalcolate a ogni tentativo e
 * possono legittimamente cambiare (VIES giu' e poi su). Confrontarle
 * produrrebbe un 409 falso su un retry identico. Si confronta quindi solo
 * la parte scritta dal cliente.
 */
const SERVER_NOTE_PREFIXES = ['[VIES ', '[SPEDIZIONE DA QUOTARE'] as const

function customerNotePart(notes: string | null | undefined): string {
  return (notes ?? '')
    .split('\n')
    .filter((line) => !SERVER_NOTE_PREFIXES.some((prefix) => line.trimStart().startsWith(prefix)))
    .join('\n')
    .trim()
}

/**
 * Un ordine gia' esistente si riusa solo se e' ancora pagabile e coerente
 * con la richiesta corrente. Pagato e non coerente sono due rifiuti distinti:
 * il primo protegge dal doppio addebito e viene PRIMA di qualunque confronto
 * (un ordine pagato non si tocca e non si svela); il secondo impedisce che
 * un documento gia' inviato al cliente venga confermato con dati diversi.
 */
function existingOrderConflict(
  existing: CmsOrderDocument | null,
  identity: OrderDocumentIdentity,
  totalCents: number,
  paymentMethod: B2BPaymentMethod,
  expectedNotes: string,
): Response | null {
  if (!existing) return null
  if (existing.paymentStatus === 'paid') {
    return errorResponse(409, 'ordine_gia_pagato')
  }

  const conflict = () => errorResponse(409, 'ordine_non_coerente')

  if (!documentFieldMatches('email', existing.customerEmail, identity.customerEmail)) return conflict()
  if (!documentFieldMatches('shippingName', existing.customerName, identity.customerName)) return conflict()
  if (!documentFieldMatches('businessName', existing.billingCompanyName, identity.billingCompanyName)) return conflict()
  if (!documentFieldMatches('vatNumber', existing.billingVatNumber, identity.billingVatNumber)) return conflict()

  // SDI storico: se il CMS non lo restituisce vale stringa vuota, non un
  // default inventato. Tutti gli altri campi assenti sono differenze.
  const existingSdi = existing.billingSdiCode
  const sdiMatches = existingSdi === undefined || existingSdi === null
    ? identity.billingSdiCode === ''
    : documentFieldMatches('sdiCode', existingSdi, identity.billingSdiCode)
  if (!sdiMatches) return conflict()

  const billing = existing.billingAddress
  if (!isRecord(billing)) return conflict()
  if (!documentFieldMatches('billingAddress1', billing.address1, identity.billingAddress.address1)) return conflict()
  if (!documentFieldMatches('billingCity', billing.city, identity.billingAddress.city)) return conflict()
  if (!documentFieldMatches('billingPostalCode', billing.postalCode, identity.billingAddress.postalCode)) return conflict()
  if (!documentFieldMatches('billingCountry', billing.country, identity.billingAddress.country)) return conflict()

  const shipping = existing.shippingAddress
  if (!isRecord(shipping)) return conflict()
  if (!documentFieldMatches('shippingName', shipping.name, identity.shippingAddress.name)) return conflict()
  if (!documentFieldMatches('shippingAddress1', shipping.address1, identity.shippingAddress.address1)) return conflict()
  if (!documentFieldMatches('shippingCity', shipping.city, identity.shippingAddress.city)) return conflict()
  if (!documentFieldMatches('shippingPostalCode', shipping.postalCode, identity.shippingAddress.postalCode)) return conflict()
  if (!documentFieldMatches('shippingCountry', shipping.country, identity.shippingAddress.country)) return conflict()

  if (
    typeof existing.total !== 'number'
    || !Number.isFinite(existing.total)
    || Math.round(existing.total * 100) !== totalCents
  ) {
    return conflict()
  }

  if (existing.paymentMethod !== paymentMethod) return conflict()

  const existingNotes = existing.notes
  if (existingNotes !== undefined && existingNotes !== null && typeof existingNotes !== 'string') {
    return conflict()
  }
  if (customerNotePart(existingNotes) !== customerNotePart(expectedNotes)) return conflict()

  return null
}

export async function handleCheckout(req: Request, deps: CheckoutDeps): Promise<Response> {
  const pre = await preflight(req, deps)
  if (!pre.ok) return pre.response
  const { form, session, email, idempotencyKey, vat, lines, productsTotalCents } = pre.ctx

  // Ospite: l'account nasce dall'ordine, senza password. La imposta al
  // primo accesso (percorso già esistente per i migrati da pro_members)
  // e da lì vede lo storico. Sta dopo la risoluzione del catalogo di
  // proposito: un carrello rifiutato non deve creare anagrafiche.
  if (!session) {
    await deps.ensureB2BAccount(email, form.businessName)
  }

  // Totale calcolato sui valori del catalogo (centesimi), mai su quelli del
  // client: il carrello e' stato risolto e allineato in `preflight`.
  const shipping = calculateResellerShipping(productsTotalCents / 100, form.shippingCountry)
  const totalCents = productsTotalCents + Math.round(shipping.cost * 100)
  const total = totalCents / 100
  const identity = orderDocumentIdentity(form, email)
  const notes = orderNotes(form, vat, shipping.mode)

  const orderNumber = orderNumberFor({ email, idempotencyKey, lines, totalCents })

  try {
    const result = await createB2BOrder({
      orderNumber,
      customerEmail: email,
      customerName: form.shippingName,
      vatNumber: form.vatNumber,
      businessName: form.businessName,
      sdiCode: form.sdiCode,
      billingAddress1: form.billingAddress1,
      billingCity: form.billingCity,
      billingPostalCode: form.billingPostalCode,
      billingCountry: form.billingCountry,
      shippingAddressName: form.shippingName,
      shippingAddress1: form.shippingAddress1,
      shippingCity: form.shippingCity,
      shippingPostalCode: form.shippingPostalCode,
      shippingCountry: form.shippingCountry,
      lineItems: lines,
      total,
      shippingCost: shipping.cost,
      paymentMethod: 'bonifico',
      notes,
    })
    const conflict = existingOrderConflict(result.existingOrder, identity, totalCents, 'bonifico', notes)
    if (conflict) return conflict
  } catch (err) {
    console.error('[b2b-checkout] CMS order create failed:', err)
    return errorResponse(500, 'Errore creazione ordine')
  }

  return NextResponse.json({ orderNumber })
}

export async function handleCreateIntent(req: Request, deps: CheckoutDeps): Promise<Response> {
  const pre = await preflight(req, deps)
  if (!pre.ok) return pre.response
  const { form, session, email, idempotencyKey, vat, lines, productsTotalCents } = pre.ctx

  // Ospite: dopo la risoluzione del catalogo, cosi' un carrello
  // rifiutato non crea anagrafiche.
  if (!session) {
    await deps.ensureB2BAccount(email, form.businessName)
  }

  // Totale sui valori del catalogo. Nessun sovrapprezzo: lo storefront
  // retail non ne applica, e caricare un +4% a chi paga con carta
  // spinge verso il bonifico proprio i rivenditori che con Stripe si
  // troverebbero a casa. La commissione la assorbiamo, come nel retail.
  const shipping = calculateResellerShipping(productsTotalCents / 100, form.shippingCountry)
  const totalCents = productsTotalCents + Math.round(shipping.cost * 100)
  const total = totalCents / 100
  const amountCents = totalCents
  const identity = orderDocumentIdentity(form, email)
  const notes = orderNotes(form, vat, shipping.mode)

  const orderNumber = orderNumberFor({ email, idempotencyKey, lines, totalCents })

  // Create the pending order through Payload so all CMS hooks run.
  let orderId: string | number
  let existing: CmsOrder | null
  try {
    const result = await createB2BOrder({
      orderNumber,
      customerEmail: email,
      customerName: form.shippingName,
      vatNumber: form.vatNumber,
      businessName: form.businessName,
      sdiCode: form.sdiCode,
      billingAddress1: form.billingAddress1,
      billingCity: form.billingCity,
      billingPostalCode: form.billingPostalCode,
      billingCountry: form.billingCountry,
      shippingAddressName: form.shippingName,
      shippingAddress1: form.shippingAddress1,
      shippingCity: form.shippingCity,
      shippingPostalCode: form.shippingPostalCode,
      shippingCountry: form.shippingCountry,
      lineItems: lines,
      total,
      shippingCost: shipping.cost,
      paymentMethod: 'stripe',
      notes,
    })
    orderId = result.orderId
    existing = result.existingOrder
  } catch (err) {
    console.error('[b2b-checkout] CMS order create failed:', err)
    return errorResponse(500, 'Errore creazione ordine')
  }

  // Pagato o non coerente: si ferma qui, senza toccare Stripe. Il riuso di
  // un ordine pendente procede e la stessa idempotency key del provider
  // restituisce la PaymentIntent gia' creata.
  const conflict = existingOrderConflict(existing, identity, totalCents, 'stripe', notes)
  if (conflict) return conflict

  try {
    const paymentIntent = await deps.createPaymentIntent({
      amountCents,
      orderId,
      orderNumber,
      resellerEmail: email,
    })
    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      orderId,
      orderNumber,
    })
  } catch (err) {
    console.error('[b2b-checkout] stripe.paymentIntents.create failed (orderId=%s):', orderId, err)
    return errorResponse(502, 'Errore pagamento')
  }
}
