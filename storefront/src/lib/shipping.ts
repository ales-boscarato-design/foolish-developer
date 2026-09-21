/**
 * Calcolo spedizione Foolish Butcher — unica fonte di verita'.
 *
 * Tre zone, definite da come si attraversa il confine doganale, non da come
 * si chiama il continente:
 *
 *   IT        7,65 EUR  → gratis sopra 50 EUR      (tariffa corriere)
 *   EU        14,99 EUR → gratis sopra 150 EUR     (tariffa corriere)
 *   EXTRA_EU  costo sdoganato (landed cost)        (mai sotto il costo stimato)
 *
 * Perche' EXTRA_EU esiste separata da EU: Svizzera, Norvegia, Regno Unito e
 * resto del mondo NON sono nel territorio doganale dell'Unione. Una spedizione
 * li' paga dazi, IVA all'importazione, la fee DDP e l'assicurazione: voci che
 * nelle spedizioni nazionali/UE non esistono e che crescono col valore della
 * merce. Una tariffa piatta non le copre mai.
 *
 * Misura che ha aperto il caso (2026-09): ordine CMS 31 a Basel CH, merce
 * 99,00 EUR → incassato 14,99 EUR di spedizione, costo reale 47,72 EUR.
 * Perdita 32,73 EUR su un pacco (3,18 volte l'incassato).
 *
 * Il profilo di ogni paese e' qui dentro, in un solo posto: lo storefront lo
 * usa per il totale mostrato e per quello incassato. La chiave API Packlink NON
 * entra mai nel calcolo: qui ci sono solo tariffe e oneri misurati, mai
 * credenziali.
 */

export const EU_CUSTOMS_UNION = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU',
  'IE','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
])

/**
 * Nome storico usato dal resto del codice (abbonamenti, zone). Coincide con
 * l'unione doganale: la Svizzera e la Norvegia NON ne fanno parte.
 */
export const EU_COUNTRIES = EU_CUSTOMS_UNION

export const ALLOWED_SHIPPING_COUNTRIES = [
  'IT','DE','FR','ES','NL','BE','AT','CH','PL','PT','SE','DK','NO',
  'US','GB','CA','AU','JP','BR',
] as const

export type AllowedShippingCountry = typeof ALLOWED_SHIPPING_COUNTRIES[number]

export function isAllowedShippingCountry(value: unknown): value is AllowedShippingCountry {
  return typeof value === 'string'
    && ALLOWED_SHIPPING_COUNTRIES.includes(value as AllowedShippingCountry)
}

export type ShippingZone = 'IT' | 'EU' | 'EXTRA_EU'

export interface LandedCostBreakdown {
  /** Trasporto del corriere (base del collo di riferimento). */
  carrier: number
  /** Assicurazione, quota sul valore della merce. */
  insurance: number
  /** Dazio all'importazione. */
  duty: number
  /** IVA all'importazione (0 se sotto la soglia di de minimis). */
  importVat: number
  /** Oneri fissi di sdoganamento che non dipendono dal valore (disborso corriere). */
  fixedImportFee: number
  /** Fee DDP Packlink. */
  ddpFee: number
  /** Gestione Packlink. */
  handlingFee: number
  /** Margine sopra il costo. 0 = a costo. */
  margin: number
  /** Costo sdoganato stimato, senza margine. */
  estimatedCost: number
  /** Totale addebitabile al cliente (arrotondato per eccesso al centesimo). */
  total: number
  /** false = paese non ancora misurato: il profilo e' prudenziale, non calibrato. */
  calibrated: boolean
  /** Da dove viene il profilo. */
  source: string
}

export interface ShippingRate {
  zone: ShippingZone
  cost: number
  /** Soglia di spedizione gratuita sul valore merce. null = mai gratuita. */
  freeAbove: number | null
  isFree: boolean
  /** Presente solo per EXTRA_EU: scomposizione del costo sdoganato. */
  landedCost: LandedCostBreakdown | null
  /** Se una promo "spedizione gratuita" puo' azzerare questa tariffa. */
  freeShippingPromoAllowed: boolean
}

export interface ExtraEuProfile {
  /** Trasporto per il collo di riferimento della zona. */
  carrier: number
  /** Assicurazione: quota sul valore della merce. */
  insuranceRate: number
  /** Dazio all'importazione: quota sulla base CIF (merce + trasporto). */
  dutyRate: number
  /** IVA all'importazione: quota sulla base imponibile. */
  importVatRate: number
  /**
   * Oneri fissi di sdoganamento non proporzionali al valore (disborso del
   * corriere, brokeraggio). Nel caso misurato e' il residuo dei
   * `customs_and_duties` che l'IVA all'importazione non spiega.
   */
  fixedImportFee: number
  /** Fee DDP Packlink. */
  ddpFee: number
  /** Gestione Packlink. */
  handlingFee: number
  /**
   * Sotto questa base imponibile (in EUR) l'IVA all'importazione non viene
   * applicata. null = nessuna soglia: l'IVA si applica sempre (prudente).
   */
  importVatExemptBelow: number | null
  /**
   * Margine sopra il costo sdoganato. 0 = a costo.
   * PUNTO DI PREZZO: lo decide Alessandro, non il codice.
   */
  marginRate: number
  /**
   * Spedizione gratuita sopra questo valore merce. null = mai gratuita:
   * su una spedizione extra-UE la gratuita significa regalare lo sdoganamento.
   */
  freeAbove: number | null
  /**
   * Se una promo "spedizione gratuita" puo' azzerare la tariffa. Su extra-UE
   * resta false: la promo azzererebbe il costo reale, non solo il trasporto.
   */
  freeShippingPromoAllowed: boolean
  /** true solo se i parametri vengono da una spedizione reale misurata. */
  calibrated: boolean
  /** Provenienza dei numeri. */
  source: string
}

/**
 * Profilo Svizzera — MISURATO, non stimato.
 *
 * Ordine CMS 31 / FOOLISH-1788184527086, Basel 4058, collo 40x40x10 / 2,0 kg,
 * merce 99,00 EUR. Costo reale alla cassa: 23,00 corriere + 0,99 gestione +
 * 4,00 assicurazione + 14,77 oneri doganali + 4,96 fee DDP = 47,72 EUR.
 *
 * I parametri riproducono quella misura al centesimo (vedi shipping.test.ts):
 *   IVA 8,1% su (99,00 + 23,00 + 4,00 + 0,99 + 4,96) = 10,69
 *   residuo non spiegato dall'IVA = 14,77 − 10,69 = 4,08 → fixedImportFee
 *
 * Dazio 0: i prodotti industriali dei cap. 25-97 sono esenti dal 1/1/2024 a
 * prescindere dall'origine.
 *
 * UN SOLO PUNTO DI MISURA: e' una calibrazione a un punto. La curva va tarata
 * su 3-5 spedizioni extra-UE con valori diversi (Alfred registra il costo reale
 * di ognuna con `pipeline.py margini`). Finche' non ci sono, il profilo resta
 * prudenziale: meglio addebitare un euro in piu' che regalare lo sdoganamento.
 */
export const SWITZERLAND_PROFILE: ExtraEuProfile = {
  carrier: 23.00,
  insuranceRate: 0.0404,
  dutyRate: 0,
  importVatRate: 0.081,
  fixedImportFee: 4.08,
  ddpFee: 4.96,
  handlingFee: 0.99,
  // De minimis CH: nessuna IVA se l'imposta e' sotto CHF 5 (≈ CHF 62 di valore
  // complessivo). Tenuta SPENTA: la soglia in EUR dipende dal cambio, e
  // sbagliarla vuol dire spedire sotto costo. Da accendere con un cambio
  // confermato, non con un cambio stimato.
  importVatExemptBelow: null,
  // Punto di prezzo: da approvare. 0 = la spedizione viaggia a costo.
  marginRate: 0,
  // Mai gratuita: sopra soglia lo sdoganamento lo pagherebbe Foolish.
  freeAbove: null,
  freeShippingPromoAllowed: false,
  calibrated: true,
  source: 'misurato — CMS 31 Basel CH, collo 40x40x10 2,0 kg, merce 99,00 EUR (2026-09)',
}

/**
 * Copertura per paese. Ogni paese extra-UE di ALLOWED_SHIPPING_COUNTRIES che
 * non compare qui usa DEFAULT_EXTRA_EU_PROFILE e viene marcato `calibrated:
 * false`: il prezzo non scende sotto il profilo misurato piu' caro.
 */
export const LANDED_COST_COUNTRIES: Partial<Record<AllowedShippingCountry, ExtraEuProfile>> = {
  CH: SWITZERLAND_PROFILE,
}

/** Profilo prudenziale per i paesi non ancora misurati. */
export const DEFAULT_EXTRA_EU_PROFILE: ExtraEuProfile = {
  ...SWITZERLAND_PROFILE,
  calibrated: false,
  source: 'prudenziale — profilo CH misurato, esteso a un paese non ancora misurato',
}

/** Tariffa piatta minima per un paese non misurato (storico "Resto del mondo"). */
export const UNCALIBRATED_EXTRA_EU_FLAT = 37.95

interface FlatZoneConfig {
  cost: number
  freeAbove: number
}

/** Zone senza dogana: nessun cambiamento rispetto alla tariffa corriere. */
export const FLAT_ZONE_CONFIG: Record<'IT' | 'EU', FlatZoneConfig> = {
  IT: { cost: 7.65, freeAbove: 50 },
  EU: { cost: 14.99, freeAbove: 150 },
}

export function getShippingZone(countryCode: string): ShippingZone {
  const c = String(countryCode ?? '').toUpperCase()
  if (c === 'IT') return 'IT'
  if (EU_CUSTOMS_UNION.has(c)) return 'EU'
  return 'EXTRA_EU'
}

/** Arrotondamento al centesimo, mezzo centesimo per eccesso (mai sotto costo). */
function cents(value: number): number {
  return Math.ceil(Number((value * 100).toFixed(6))) / 100
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

export function calculateLandedCost(
  cartTotal: number,
  profile: ExtraEuProfile,
): LandedCostBreakdown {
  const goods = Math.max(0, roundCents(cartTotal))

  const insurance = roundCents(goods * profile.insuranceRate)
  const carrier = roundCents(profile.carrier)
  const handlingFee = roundCents(profile.handlingFee)
  const ddpFee = roundCents(profile.ddpFee)
  const fixedImportFee = roundCents(profile.fixedImportFee)

  // Base imponibile IVA all'importazione: merce + trasporto + assicurazione +
  // costi di formalita' (gestione + fee DDP). Gli oneri fissi di disborso
  // restano fuori: sono il residuo misurato, non una voce della base.
  const vatBase = roundCents(goods + carrier + insurance + handlingFee + ddpFee)
  const exempt = profile.importVatExemptBelow !== null && vatBase < profile.importVatExemptBelow
  const importVat = exempt ? 0 : roundCents(vatBase * profile.importVatRate)

  const duty = roundCents((goods + carrier) * profile.dutyRate)

  const estimatedCost = roundCents(
    carrier + insurance + duty + importVat + fixedImportFee + ddpFee + handlingFee,
  )
  const margin = roundCents(estimatedCost * profile.marginRate)
  const total = cents(estimatedCost + margin)

  return {
    carrier,
    insurance,
    duty,
    importVat,
    fixedImportFee,
    ddpFee,
    handlingFee,
    margin,
    estimatedCost,
    total,
    calibrated: profile.calibrated,
    source: profile.source,
  }
}

export function calculateShipping(cartTotal: number, countryCode: string): ShippingRate {
  const zone = getShippingZone(countryCode)

  if (zone === 'IT' || zone === 'EU') {
    const { cost, freeAbove } = FLAT_ZONE_CONFIG[zone]
    const isFree = cartTotal >= freeAbove
    return {
      zone,
      cost: isFree ? 0 : cost,
      freeAbove,
      isFree,
      landedCost: null,
      freeShippingPromoAllowed: true,
    }
  }

  const country = String(countryCode ?? '').toUpperCase() as AllowedShippingCountry
  const profile = LANDED_COST_COUNTRIES[country] ?? DEFAULT_EXTRA_EU_PROFILE
  const landed = calculateLandedCost(cartTotal, profile)

  // Guardia di accettazione: su extra-UE non si parte mai sotto il costo
  // sdoganato stimato. Per i paesi non misurati il profilo e' prudenziale e la
  // tariffa piatta storica resta un pavimento.
  const cost = profile.calibrated
    ? landed.total
    : Math.max(landed.total, UNCALIBRATED_EXTRA_EU_FLAT)

  const freeAbove = profile.freeAbove
  const isFree = freeAbove !== null && cartTotal >= freeAbove

  return {
    zone,
    cost: isFree ? 0 : cost,
    freeAbove,
    isFree,
    landedCost: landed,
    freeShippingPromoAllowed: profile.freeShippingPromoAllowed,
  }
}

/** Se una promo "spedizione gratuita" puo' azzerare la tariffa per questo paese. */
export function isFreeShippingPromoAllowed(countryCode: string): boolean {
  return calculateShipping(0, countryCode).freeShippingPromoAllowed
}

export function shippingLabel(zone: ShippingZone): string {
  const labels: Record<ShippingZone, string> = {
    IT: 'Italia',
    EU: 'Unione Europea',
    EXTRA_EU: 'Extra-UE (sdoganamento incluso)',
  }
  return labels[zone]
}

/**
 * Quanto manca alla spedizione gratuita. 0 quando non c'e' una soglia: su
 * extra-UE la spedizione gratuita non esiste, quindi non c'e' nulla da
 * inseguire.
 */
export function freeShippingRemaining(cartTotal: number, countryCode: string): number {
  const zone = getShippingZone(countryCode)
  if (zone === 'EXTRA_EU') return 0
  const threshold = FLAT_ZONE_CONFIG[zone].freeAbove
  return Math.max(0, threshold - cartTotal)
}
