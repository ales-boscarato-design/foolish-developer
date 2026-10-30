/**
 * Prezzo extra-UE: la parte PURA della catena, riusabile dal browser.
 *
 * Perche' esiste separato da `landed-cost.ts`: quel modulo parla con la Pi e
 * firma i gettoni, quindi usa `node:crypto` e un segreto e NON puo' finire nel
 * bundle del browser. Qui non c'e' nessuna credenziale, nessuna chiamata di
 * rete, nessun modulo di sistema: solo l'aritmetica del prezzo, la stessa per
 * il server e per la pagina di checkout.
 *
 * MISURA che ha aperto questo file (21/09/2026): quando la risposta del server
 * non arrivava al browser, la pagina mostrava il prezzo del solo PROFILO di
 * paese mentre il checkout incassava `max(profilo, tabella in casa)`. Su 32
 * combinazioni (8 paesi x 4 valori di merce) 18 divergevano, con la pagina
 * SOTTO: CA merce 50,00 mostrato 50,14 / incassato 95,73; JP 50,00 → 48,00 /
 * 111,65; US 99,00 → 48,00 / 84,14. Il cliente pagava piu' di quello che aveva
 * visto. La regola che questo file rende strutturale:
 *
 *   il prezzo MOSTRATO su una destinazione extra-UE non e' mai inferiore a
 *   quello che il checkout INCASSA.
 *
 * Non si mostra un prezzo piu' alto del dovuto per prudenza: quando il server
 * ha risposto, la pagina mostra ESATTAMENTE quel prezzo (e' quello che il
 * gettone firmato fa incassare). La regola prudenziale si applica solo quando
 * il prezzo del server non c'e'.
 */

import {
  DEFAULT_EXTRA_EU_PROFILE,
  EXTRA_EU_MARGIN_RATE,
  EXTRA_EU_MINIMUM_SHIPPING,
  LANDED_COST_COUNTRIES,
  calculateLandedCost,
  getShippingZone,
  type ExtraEuProfile,
  type LandedCostBreakdown,
} from './shipping'
import landedCostTable from './landed-cost-table.json'

/** Pavimento di spedizione addebitata extra-UE, in centesimi interi. */
export const EXTRA_EU_MINIMUM_SHIPPING_CENTS = Math.ceil(EXTRA_EU_MINIMUM_SHIPPING * 100)

interface LandingTableBand {
  goodsValueCents: number
  /** Base di prezzo della banda: la quota del servizio sulla copertura approvata. */
  costBasisCents: number
  shippingAndImportCents: number
  /** Stima dichiarata dal servizio (`landed_cost_estimate`), se registrata. */
  landedCostCents: number | null
  /** Copertura assicurativa approvata che la banda dichiara, se registrata. */
  insuranceCoveragePolicy: string | null
  insuranceBaseCents: number | null
  insurancePremiumCents: number | null
  serviceId: number | null
  checkoutInvoiceNumber: string | null
  quotedAt: string | null
}

interface LandingTableCountry {
  bands: LandingTableBand[]
}

let cachedTable: Map<string, LandingTableBand[]> | null = null

/** Euro (anche non finiti) → centesimi interi. null se non e' un numero valido. */
export function toCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null
  const cents = Math.round(value * 100)
  if (!Number.isSafeInteger(cents)) return null
  return cents
}

/**
 * Intero di centesimi GIA' in centesimi (tabella in casa, che nasce dai centesimi
 * della quota): convertirli di nuovo moltiplicherebbe il prezzo per 100.
 */
function positiveCentsInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return null
  return value
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) return null
  return trimmed
}

/**
 * Tabella dei prezzi reali tenuta in casa, letta una volta e validata.
 *
 * Una banda senza importi interi e positivi viene SCARTATA: una tabella
 * malformata deve degradare al profilo, mai produrre un prezzo a zero.
 */
export function loadLandedCostTable(raw: unknown = landedCostTable): Map<string, LandingTableBand[]> {
  if (cachedTable && raw === landedCostTable) return cachedTable
  const bands = new Map<string, LandingTableBand[]>()

  if (raw && typeof raw === 'object') {
    const countries = (raw as { countries?: unknown }).countries
    if (countries && typeof countries === 'object' && !Array.isArray(countries)) {
      for (const [code, value] of Object.entries(countries as Record<string, unknown>)) {
        const country = code.trim().toUpperCase()
        if (!/^[A-Z]{2}$/.test(country)) continue
        const entries = (value as LandingTableCountry | null)?.bands
        if (!Array.isArray(entries)) continue
        const parsed: LandingTableBand[] = []
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue
          const candidate = entry as unknown as Record<string, unknown>
          const goodsValueCents = positiveCentsInt(candidate.goods_value_cents)
          const costBasisCents = positiveCentsInt(candidate.cost_basis_cents)
          const shippingAndImportCents = positiveCentsInt(candidate.shipping_and_import_cents)
          if (goodsValueCents === null || costBasisCents === null || shippingAndImportCents === null) continue
          parsed.push({
            goodsValueCents,
            // La base di prezzo non sta mai sotto una cifra che il servizio ha
            // dichiarato per quella banda (quota o stima): una banda incoerente
            // alza la base, non la abbassa.
            costBasisCents: Math.max(
              costBasisCents,
              shippingAndImportCents,
              positiveCentsInt(candidate.landed_cost_cents) ?? 0,
            ),
            shippingAndImportCents,
            landedCostCents: positiveCentsInt(candidate.landed_cost_cents),
            insuranceCoveragePolicy: boundedString(candidate.insurance_coverage_policy, 40),
            insuranceBaseCents: positiveCentsInt(candidate.insurance_base_cents),
            insurancePremiumCents: positiveCentsInt(candidate.insurance_premium_cents),
            serviceId: Number.isSafeInteger(candidate.service_id) ? candidate.service_id as number : null,
            checkoutInvoiceNumber: boundedString(candidate.checkout_invoice_number, 64),
            quotedAt: boundedString(candidate.quoted_at, 40),
          })
        }
        if (parsed.length > 0) {
          parsed.sort((a, b) => a.goodsValueCents - b.goodsValueCents)
          bands.set(country, parsed)
        }
      }
    }
  }

  if (raw === landedCostTable) cachedTable = bands
  return bands
}

/**
 * Costo reale dalla tabella in casa per quel valore di merce.
 *
 * Si prende la banda piu' piccola che copre il carrello (mai una banda piu'
 * bassa della merce: sarebbe una sottostima). Sopra l'ultima banda si usa
 * l'ultima banda misurata: e' un PAVIMENTO del costo reale, non una stima — la
 * stima per quei carrelli la fa il profilo di paese, e il chiamante prende il
 * maggiore dei due.
 */
export function tableCostCents(countryCode: string, goodsCents: number): number | null {
  const country = String(countryCode ?? '').trim().toUpperCase()
  const bands = loadLandedCostTable().get(country)
  if (!bands || bands.length === 0) return null
  const goods = Number.isFinite(goodsCents) ? Math.max(0, Math.round(goodsCents)) : 0
  for (const band of bands) {
    if (goods <= band.goodsValueCents) return band.costBasisCents
  }
  return bands[bands.length - 1]!.costBasisCents
}

/** Stima di costo del profilo di paese (senza margine, senza pavimento). */
export function profileCostCents(countryCode: string, goodsCents: number): number | null {
  const country = String(countryCode ?? '').trim().toUpperCase()
  if (getShippingZone(country) !== 'EXTRA_EU') return null
  const profile: ExtraEuProfile = LANDED_COST_COUNTRIES[country as keyof typeof LANDED_COST_COUNTRIES]
    ?? DEFAULT_EXTRA_EU_PROFILE
  const landed: LandedCostBreakdown = calculateLandedCost(goodsCents / 100, profile)
  return toCents(landed.estimatedCost)
}

/** Margine sul costo, in centesimi. Stessa aritmetica del server. */
export function extraEuMarginCents(basisCostCents: number): number {
  const marginRate = Number.isFinite(EXTRA_EU_MARGIN_RATE) ? Math.max(0, EXTRA_EU_MARGIN_RATE) : 0
  return Math.round(basisCostCents * marginRate)
}

/** Prezzo (centesimi) che nasce da una base di costo: base + margine. */
export function priceFromBasisCents(basisCostCents: number): number {
  return basisCostCents + extraEuMarginCents(basisCostCents)
}

/**
 * Base di costo prudenziale = il MAGGIORE fra profilo di paese e tabella in
 * casa. E' la regola del server: prenderne solo una sottostima il costo.
 */
export function prudentialBasisCents(
  profileCost: number | null,
  tableCost: number | null,
): number {
  return Math.max(profileCost ?? 0, tableCost ?? 0)
}

/**
 * Prezzo prudenziale di una destinazione extra-UE: `max(profilo, tabella)` +
 * margine, mai sotto il pavimento. `null` se il paese non e' extra-UE.
 *
 * E' il prezzo che il server addebita quando la quota live non risponde e non
 * c'e' gettone — per costruzione lo stesso numero che il browser mostra.
 */
export function prudentialExtraEuPriceCents(countryCode: string, goodsCents: number): number | null {
  const country = String(countryCode ?? '').trim().toUpperCase()
  if (getShippingZone(country) !== 'EXTRA_EU') return null
  const basis = prudentialBasisCents(
    profileCostCents(country, goodsCents),
    tableCostCents(country, goodsCents),
  )
  const price = Math.max(priceFromBasisCents(basis), EXTRA_EU_MINIMUM_SHIPPING_CENTS)
  return Number.isSafeInteger(price) && price > 0 ? price : null
}

/**
 * Quello che la pagina di checkout MOSTRA nella riga "spedizione e import".
 *
 *   - prezzo risposto dal server (quota live, tabella o prudenziale): si mostra
 *     quello, perche' e' quello che il gettone firmato fa incassare;
 *   - nessuna risposta dal server (429, 503, carrello con pack, l'utente paga
 *     prima che la quota atterri): si applica la stessa regola del server, non
 *     il solo profilo di paese;
 *   - paese non extra-UE: `null`, e la pagina usa la sua tariffa corriere.
 */
export function extraEuDisplayedPriceCents(args: {
  countryCode: string
  goodsCents: number
  serverQuotedCents?: number | null
}): number | null {
  const country = String(args.countryCode ?? '').trim().toUpperCase()
  if (getShippingZone(country) !== 'EXTRA_EU') return null
  const quoted = args.serverQuotedCents
  if (typeof quoted === 'number' && Number.isSafeInteger(quoted) && quoted > 0) return quoted
  return prudentialExtraEuPriceCents(country, args.goodsCents)
}
