/**
 * Riconciliazione del carrello dopo un rifiuto di checkout.
 *
 * Modulo puro: nessun import da Next, nessun I/O, nessuno store. La pagina lo
 * usa per decidere cosa mostrare dopo un rifiuto e per applicare un prezzo
 * nuovo SOLO dopo che il cliente ha approvato esplicitamente il pannello di
 * revisione. `applyPriceUpdate` non viene mai chiamata come effetto
 * collaterale di una lettura.
 *
 * Regola di fondo: un codice sconosciuto non produce mai una navigazione. La
 * decisione e' sempre `errore` o `revisione`.
 */

import { lineTotalCents } from './b2b-pricing'
import type { PriceTier } from './cms'

export interface CheckoutFailureClassification {
  messageKey: string
  requiresPriceReview: boolean
  regenerateKey: boolean
}

export interface CheckoutFailureDecision {
  action: 'errore' | 'revisione'
  messageKey: string
  regenerateKey: boolean
}

export interface AuthoritativePriceLine {
  variantSku: string
  qty: number
  available: boolean
  unitPrice: number | null
  priceTiers: PriceTier[]
  lineTotalCents: number
}

/** La risposta di POST /api/cart/prices. */
export interface CartPricesResponse {
  productsTotalCents: number
  items: AuthoritativePriceLine[]
}

/** Il minimo che una riga del carrello deve esporre per essere riconciliata. */
export interface ReconcileCartLine {
  variantSku: string
  qty: number
  unitPrice: number
  priceTiers: PriceTier[]
}

export interface CartPriceDiffRow {
  variantSku: string
  qty: number
  oldUnitPrice: number
  newUnitPrice: number | null
  newLineTotalCents: number
  changed: boolean
  available: boolean
}

export interface CartPriceDiff {
  rows: CartPriceDiffRow[]
  oldProductsTotalCents: number
  newProductsTotalCents: number
  deltaCents: number
  hasChanges: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorCode(body: unknown): string | null {
  if (!isRecord(body)) return null
  return typeof body.error === 'string' ? body.error : null
}

function classifyCode(code: string): CheckoutFailureClassification {
  switch (code) {
    case 'prezzo_non_allineato':
    case 'fasce_non_allineate':
      return {
        messageKey: 'errorPrezziCambiati',
        requiresPriceReview: true,
        regenerateKey: false,
      }
    case 'sku_non_disponibile':
    case 'prodotto_non_disponibile':
    case 'variante_non_disponibile':
      return {
        messageKey: 'errorProdottoNonDisponibile',
        requiresPriceReview: true,
        regenerateKey: false,
      }
    case 'catalogo_non_disponibile':
    case 'catalogo_incompleto':
    case 'catalogo_non_valido':
      return { messageKey: 'errorCatalogo', requiresPriceReview: false, regenerateKey: false }
    case 'ordine_gia_pagato':
      return { messageKey: 'errorOrdineGiaPagato', requiresPriceReview: false, regenerateKey: false }
    case 'ordine_non_coerente':
      return { messageKey: 'errorOrdineNonCoerente', requiresPriceReview: false, regenerateKey: false }
    case 'partita_iva_non_valida':
      return { messageKey: 'errorPartitaIva', requiresPriceReview: false, regenerateKey: false }
    case 'email_non_valida':
    case 'ragione_sociale_mancante':
    case 'campo_non_valido':
    case 'body_non_valido':
      return { messageKey: 'errorForm', requiresPriceReview: false, regenerateKey: false }
    case 'chiave_idempotenza_mancante':
      return { messageKey: 'errorGenerico', requiresPriceReview: false, regenerateKey: true }
    default:
      return { messageKey: 'errorGenerico', requiresPriceReview: false, regenerateKey: false }
  }
}

/**
 * Classifica un rifiuto della rotta di checkout.
 *
 * Un 5xx e' sempre `errorGenerico`, anche se il corpo portasse per errore un
 * codice di prezzo: un guasto del server non e' una revisione di prezzo. Un
 * corpo non leggibile o un codice sconosciuto finiscono nello stesso posto.
 */
export function classifyCheckoutFailure(
  status: number,
  body: unknown,
): CheckoutFailureClassification {
  const code = errorCode(body)
  // I codici del catalogo sono esplicitamente mappati anche quando arrivano
  // con 503: la rotta prezzi e il checkout usano 503 per un catalogo che non
  // si riesce a leggere, e il cliente deve vedere il messaggio dedicato.
  if (
    code === 'catalogo_non_disponibile' ||
    code === 'catalogo_incompleto' ||
    code === 'catalogo_non_valido'
  ) {
    return classifyCode(code)
  }
  // Ogni altro 5xx e' un guasto generico, anche se il corpo portasse per
  // errore un codice di prezzo.
  if (status >= 500) {
    return { messageKey: 'errorGenerico', requiresPriceReview: false, regenerateKey: false }
  }
  if (code === null) {
    return { messageKey: 'errorGenerico', requiresPriceReview: false, regenerateKey: false }
  }
  return classifyCode(code)
}

/**
 * La decisione che la pagina puo' usare senza browser: nessuna navigazione,
 * nessun altro campo oltre a quelli dichiarati.
 */
export function decideAfterCheckoutFailure(
  status: number,
  body: unknown,
): CheckoutFailureDecision {
  const classification = classifyCheckoutFailure(status, body)
  return {
    action: classification.requiresPriceReview ? 'revisione' : 'errore',
    messageKey: classification.messageKey,
    regenerateKey: classification.regenerateKey,
  }
}

function priceBySku(prices: CartPricesResponse): Map<string, AuthoritativePriceLine> {
  const map = new Map<string, AuthoritativePriceLine>()
  for (const line of prices.items) {
    if (!map.has(line.variantSku)) map.set(line.variantSku, line)
  }
  return map
}

/**
 * Confronta il carrello con la risposta autorevole della rotta prezzi.
 *
 * I totali si sommano sempre in centesimi con `lineTotalCents`, la stessa
 * funzione usata dal checkout: mai float sommati fra loro. Una riga assente
 * dalla risposta e' `available: false`, non una riga ignorata in silenzio.
 */
export function diffCartPrices(
  items: readonly ReconcileCartLine[],
  prices: CartPricesResponse,
): CartPriceDiff {
  const bySku = priceBySku(prices)
  let oldProductsTotalCents = 0
  let newProductsTotalCents = 0
  let hasChanges = false

  const rows: CartPriceDiffRow[] = items.map((item) => {
    const authoritative = bySku.get(item.variantSku)
    const available = authoritative?.available === true
    const newUnitPrice = authoritative && typeof authoritative.unitPrice === 'number'
      ? authoritative.unitPrice
      : null
    const newLineTotalCents = newUnitPrice === null
      ? 0
      : lineTotalCents(newUnitPrice, item.qty, authoritative?.priceTiers ?? [])

    const oldLineTotalCents = lineTotalCents(item.unitPrice, item.qty, item.priceTiers)
    oldProductsTotalCents += oldLineTotalCents
    newProductsTotalCents += newLineTotalCents

    const changed = !available || newUnitPrice !== item.unitPrice
    if (changed) hasChanges = true

    return {
      variantSku: item.variantSku,
      qty: item.qty,
      oldUnitPrice: item.unitPrice,
      newUnitPrice,
      newLineTotalCents,
      changed,
      available,
    }
  })

  return {
    rows,
    oldProductsTotalCents,
    newProductsTotalCents,
    deltaCents: newProductsTotalCents - oldProductsTotalCents,
    hasChanges,
  }
}

/**
 * Applica i prezzi autorevoli restituendo un NUOVO array di righe.
 *
 * Non tocca lo store e non modifica l'array in ingresso. La pagina la chiama
 * solo dal gestore del pulsante "Aggiorna carrello", dopo l'approvazione:
 * nessun percorso di lettura o di ricalcolo la invoca.
 *
 * Aggiorna solo le righe disponibili con un prezzo valido. Una riga non
 * disponibile resta invariata, perche' non esiste un prezzo nuovo da
 * applicare e il cliente deve prima risolvere il carrello.
 */
export function applyPriceUpdate<T extends ReconcileCartLine>(
  items: readonly T[],
  prices: CartPricesResponse,
): T[] {
  const bySku = priceBySku(prices)
  return items.map((item) => {
    const authoritative = bySku.get(item.variantSku)
    if (
      !authoritative ||
      !authoritative.available ||
      typeof authoritative.unitPrice !== 'number'
    ) {
      return { ...item }
    }
    return {
      ...item,
      unitPrice: authoritative.unitPrice,
      priceTiers: authoritative.priceTiers.map((tier) => ({ ...tier })),
    }
  })
}
