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
 * Il 21/09/2026 il registro Packlink e' stato riletto per intero (229
 * spedizioni, 21 extra-UE) e i `customs_and_duties` dell'ordine 31 sono stati
 * aperti: dentro i 14,77 EUR ci sono dazi 0,00 + IVA all'importazione 9,88 +
 * spese di sdoganamento 4,89. Ne escono due regole, e il profilo CH e' corretto
 * su quelle (vedi SWITZERLAND_PROFILE): la base dell'IVA all'importazione e'
 * merce + trasporto REALE del corriere, e le spese di sdoganamento sono una
 * voce MISURATA, non un residuo che compensa un errore. Delle 21 spedizioni
 * extra-UE una sola e' partita in DDP (CH): le altre 20 sono DAP, quindi per GB
 * e US gli oneri import non esistono sul nostro conto e non sono stimabili —
 * quei profili restano non misurati per costruzione, non per pigrizia.
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
 * Zone commerciali dell'abbonamento ("abbonamento pelle mensile"). Resta com'e'
 * era — Svizzera e Norvegia comprese — perche' la scala dei prezzi di un
 * abbonamento e' un prodotto, non un confine doganale. Restringere questa lista
 * toglierebbe di colpo l'abbonamento a chi oggi puo' farlo; allinearla al costo
 * sdoganato cambia un importo ricorrente. Sono due decisioni commerciali, non
 * un effetto collaterale di questa modifica (il punto e' aperto e tracciato
 * fuori dal codice: oggi un rinnovo verso CH addebita 14,99 contro ~41-44 di
 * costo sdoganato).
 */
export const EU_COUNTRIES = new Set([
  ...EU_CUSTOMS_UNION,
  'NO','IS','LI','CH',
])

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
  /**
   * true: la destinazione e' extra-UE e non esiste ancora una misura per quel
   * paese. Non si inventa un numero e non si incassa: la spedizione si quota.
   */
  requiresQuote: boolean
}

export interface ExtraEuProfile {
  /** Trasporto per il collo di riferimento della zona (2,0 kg). */
  carrier: number
  /**
   * Assicurazione: quota sul valore della merce. Sul punto misurato (merce
   * 99,00) vale 4,00 EUR, cioe' il 2,5% del valore assicurato che Packlink
   * dichiara (160,00) riscritto sulla merce (4,04%): qui non esiste un valore
   * assicurato separato dalla merce. Il fattore 1,6162 e' un'ASSUNZIONE a un
   * punto di misura, non una regola verificata (vedi SWITZERLAND_PROFILE).
   */
  insuranceRate: number
  /** Dazio all'importazione: quota sulla base CIF (merce + trasporto). */
  dutyRate: number
  /** IVA all'importazione: quota sulla base imponibile (merce + trasporto reale). */
  importVatRate: number
  /**
   * Oneri di sdoganamento che non dipendono dal valore (disborso del corriere,
   * brokeraggio). MISURATO: `import_fees_amount` = 4,89 EUR dentro i
   * `customs_and_duties` dell'ordine 31. Non e' piu' il residuo dei 14,77 EUR
   * che l'IVA non spiegava (era 4,08: assorbiva l'errore di base dell'IVA e
   * faceva sbagliare il profilo di segno con merce diversa da 99,00).
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
 * Il 21/09/2026 i `customs_and_duties` di quell'ordine sono stati aperti e
 * separati (dazi 0,00 + IVA all'importazione 9,88 + sdoganamento 4,89). Le
 * regole reali sono quindi:
 *   IVA  8,1% su (merce 99,00 + trasporto REALE 23,00) = 9,88
 *   spese di sdoganamento = 4,89 (misurate, non un residuo)
 *   23,00 + 4,00 + 9,88 + 4,89 + 4,96 + 0,99 = 47,72 al centesimo
 *
 * Due difetti chiusi da questa misura:
 *  - la base dell'IVA all'importazione e' merce + trasporto REALE del corriere,
 *    non merce+trasporto+assicurazione+gestione+fee DDP (la base precedente):
 *    gonfiare il trasporto addebitato al cliente NON aumenta l'IVA che paghiamo;
 *  - `fixedImportFee` era 4,08 per compensazione: assorbiva l'errore di base
 *    dell'IVA (10,69 contro 9,88) e il totale tornava per costruzione. Con merce
 *    diversa da 99,00 il profilo sbagliava di segno: sotto costo sotto i 99 EUR,
 *    sopra costo sopra.
 *
 * Dazio 0: i prodotti industriali dei cap. 25-97 sono esenti dal 1/1/2024 a
 * prescindere dall'origine.
 *
 * ASSICURAZIONE — assunzione dichiarata, non regola: il costo misurato e' 4,00
 * EUR su merce 99,00. Packlink dichiara "2,5% del valore assicurato" e sul punto
 * misurato il valore assicurato era 160,00 (merce 99,00, fattura doganale
 * 113,99): 2,5% di 160 e il 4,04% di 99 danno entrambi 4,00. Le due letture
 * coincidono qui e divergono altrove, e con un solo punto non si sceglie: qui
 * resta la lettura che segue la merce (una quota, non un importo fisso). Se
 * invece il valore assicurato fosse FISSO a 160, i carrelli piccoli resterebbero
 * sottostimati di ~4,00 EUR a merce zero e di 2,79 EUR a merce 30. Si chiarisce
 * con un secondo punto DDP su merce diversa.
 *
 * UN SOLO PUNTO DI MISURA con costo sdoganato completo (le altre 20 spedizioni
 * extra-UE sono partite in DAP: gli oneri li ha pagati il destinatario). La curva
 * va tarata su 3-5 spedizioni DDP con valori diversi (Alfred registra il costo
 * reale di ognuna con `pipeline.py margini`). Finche' non ci sono, il profilo
 * resta a costo e senza margine, e nessun altro paese lo eredita come se fosse
 * una misura.
 *
 * Trasporto: 23,00 e' il costo PAGATO su quell'ordine, ed e' quello che
 * riproduce la misura. Il preventivo di oggi della stessa linea (UPS Standard
 * Access Point 22131, 21/09/2026) e' 23,99: alla prossima calibrazione va
 * riguardato, perche' il listino corrente e' ~1 EUR piu' caro del prezzo che
 * questo profilo assume.
 */
export const SWITZERLAND_PROFILE: ExtraEuProfile = {
  carrier: 23.00,
  insuranceRate: 0.0404,
  dutyRate: 0,
  importVatRate: 0.081,
  fixedImportFee: 4.89,
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
  source: 'misurato — CMS 31 Basel CH, collo 40x40x10 2,0 kg, merce 99,00 EUR (2026-09); preventivo stessa linea UPS 23,99 (21/09/2026)',
}

/**
 * Copertura per paese. Ogni paese extra-UE di ALLOWED_SHIPPING_COUNTRIES che
 * non compare qui usa un profilo prudenziale (regole CH, trasporto della linea
 * DDP-capace) ed e' marcato `calibrated: false`.
 */
export const LANDED_COST_COUNTRIES: Partial<Record<AllowedShippingCountry, ExtraEuProfile>> = {
  CH: SWITZERLAND_PROFILE,
}

/**
 * Trasporto della linea DDP-capace (UPS) per il collo di riferimento, paese per
 * paese, per i paesi che NON hanno una misura completa.
 *
 * Perche' la linea UPS e non la piu' economica: nei preventivi Packlink del
 * 21/09/2026 `ddp_support_level: supported` compare solo sulle linee UPS;
 * Poste, BRT, Fedex e TNT dichiarano `ddp: None`. La piu' economica non sa
 * sdoganare, quindi non e' un'alternativa a parita' di servizio: un profilo
 * landed-cost costruito sul preventivo piu' basso e' sotto costo tutte le volte
 * che lo sdoganamento lo paga Foolish.
 *
 * Dove esiste una spedizione reale (GB, US) vince il costo PAGATO; il preventivo
 * di oggi della stessa linea e' piu' caro ed e' scritto accanto, perche' la
 * prossima calibrazione deve partire da li'.
 *
 * BR non compare: il 21/09/2026 nessun servizio di questo account supporta il
 * DDP verso il Brasile. Senza linea DDP il modello landed-cost non e'
 * costruibile — non e' una scelta di prudenza, e' una funzione che non esiste.
 */
export const DDP_CAPABLE_CARRIER: Partial<Record<AllowedShippingCountry, { carrier: number; source: string }>> = {
  GB: {
    carrier: 18.50,
    source: 'costo pagato UPS Standard Access Point GB, 2,0 kg (2025) — 17,50 fino a 1,0 kg; preventivo stessa linea 19,49 (21/09/2026)',
  },
  US: {
    carrier: 37.60,
    source: 'costo pagato UPS Express Saver US, 2,0 kg (2025); preventivo stessa linea 52,74 (21/09/2026)',
  },
  NO: {
    carrier: 23.99,
    source: 'preventivo UPS Standard Access Point NO, 2,0 kg (21/09/2026) — la piu\' economica (Fedex 17,97) non ha DDP',
  },
  CA: {
    carrier: 43.28,
    source: 'preventivo UPS Express Saver CA, 2,0 kg (21/09/2026) — la piu\' economica (BRT 33,04) non ha DDP',
  },
  AU: {
    carrier: 64.54,
    source: 'preventivo UPS Express Saver AU, 2,0 kg (21/09/2026) — la piu\' economica (BRT 37,84) non ha DDP',
  },
  JP: {
    carrier: 64.33,
    source: 'preventivo UPS Express Saver JP, 2,0 kg (21/09/2026) — la piu\' economica (Poste 57,44) non ha DDP',
  },
}

/** Profilo prudenziale: regole CH, trasporto della linea DDP-capace del paese. */
export const DEFAULT_EXTRA_EU_PROFILE: ExtraEuProfile = {
  ...SWITZERLAND_PROFILE,
  calibrated: false,
  source: 'prudenziale — profilo CH misurato, esteso a un paese non ancora misurato',
}

/**
 * Profilo prudenziale per un paese non misurato, o null se per quel paese non
 * esiste alcuna linea DDP: in quel caso non c'e' niente da stimare, si quota.
 */
export function uncalibratedExtraEuProfile(country: AllowedShippingCountry): ExtraEuProfile | null {
  const line = DDP_CAPABLE_CARRIER[country]
  if (!line) return null
  return {
    ...DEFAULT_EXTRA_EU_PROFILE,
    carrier: line.carrier,
    source: `prudenziale — oneri import NON misurati (regole CH applicate); ${line.source}`,
  }
}

/** Tariffa piatta minima per un paese non misurato (storico "Resto del mondo"). */
export const UNCALIBRATED_EXTRA_EU_FLAT = 37.95

/**
 * Cosa fare con un paese extra-UE che non ha ancora una misura.
 *
 *   'quote_required'      (default) non si vende a un prezzo indovinato: la
 *                         spedizione si quota a mano finche' il paese non ha
 *                         la sua misura. E' l'unica politica che non puo'
 *                         spedire sotto costo, perche' non spedisce affatto.
 *   'conservative_profile'  si applica il profilo CH misurato con il pavimento
 *                         storico, sul trasporto della linea DDP-capace.
 *                         Sblocca le vendite, ma NON e' prudente sugli oneri
 *                         import: il Regno Unito ha IVA 20% e la Norvegia 25%
 *                         (qui si applica l'8,1% svizzero: sotto costo), gli
 *                         Stati Uniti non hanno IVA all'importazione sotto gli
 *                         800 USD (sopra costo). Il trasporto e' misurato o
 *                         preventivato, gli oneri no.
 *
 * La scelta e' commerciale: default fail-closed, si cambia con una riga. Il
 * Brasile resta `quote_required` in ogni caso, anche girando questa politica,
 * perche' non ha alcuna linea DDP.
 */
export type UncalibratedExtraEuPolicy = 'quote_required' | 'conservative_profile'

export const UNCALIBRATED_EXTRA_EU_POLICY: UncalibratedExtraEuPolicy = 'quote_required'

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
  // Un valore non finito non deve diventare NaN nel prezzo mostrato: si tratta
  // come merce a zero (restano comunque gli oneri fissi).
  const goods = Number.isFinite(cartTotal) ? Math.max(0, roundCents(cartTotal)) : 0

  const insurance = roundCents(goods * profile.insuranceRate)
  const carrier = roundCents(profile.carrier)
  const handlingFee = roundCents(profile.handlingFee)
  const ddpFee = roundCents(profile.ddpFee)
  const fixedImportFee = roundCents(profile.fixedImportFee)

  // Base imponibile IVA all'importazione: merce + trasporto REALE del corriere.
  // MISURATO sull'ordine 31: 8,1% di (99,00 + 23,00) = 9,88. Assicurazione,
  // gestione e fee DDP NON entrano nella base, e il trasporto addebitato al
  // cliente non entra qui: gonfiarlo non aumenta l'IVA che paghiamo.
  const vatBase = roundCents(goods + carrier)
  const exempt = profile.importVatExemptBelow !== null && vatBase < profile.importVatExemptBelow
  const importVat = exempt ? 0 : roundCents(vatBase * profile.importVatRate)

  const duty = roundCents((goods + carrier) * profile.dutyRate)

  const estimatedCost = roundCents(
    carrier + insurance + duty + importVat + fixedImportFee + ddpFee + handlingFee,
  )
  // Un margine negativo non e' un'opzione: la tariffa non parte mai sotto il
  // costo sdoganato stimato, qualunque cosa dica la configurazione.
  const marginRate = Number.isFinite(profile.marginRate) ? Math.max(0, profile.marginRate) : 0
  const margin = roundCents(estimatedCost * marginRate)
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

export function calculateShipping(
  cartTotal: number,
  countryCode: string,
  policy: UncalibratedExtraEuPolicy = UNCALIBRATED_EXTRA_EU_POLICY,
): ShippingRate {
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
      requiresQuote: false,
    }
  }

  const country = String(countryCode ?? '').toUpperCase() as AllowedShippingCountry
  const profile = LANDED_COST_COUNTRIES[country] ?? uncalibratedExtraEuProfile(country)

  // Paese senza profilo (nessuna linea DDP, es. BR) o senza misura: nessun
  // numero inventato. La spedizione si quota a mano (fail-closed) oppure si
  // applica il profilo misurato con il pavimento storico, se la politica e'
  // stata girata di proposito.
  if (!profile || (!profile.calibrated && policy === 'quote_required')) {
    return {
      zone,
      cost: 0,
      freeAbove: null,
      isFree: false,
      landedCost: null,
      freeShippingPromoAllowed: false,
      requiresQuote: true,
    }
  }

  const landed = calculateLandedCost(cartTotal, profile)

  // Guardia di accettazione: su extra-UE non si parte mai sotto il costo
  // sdoganato stimato. Per i paesi non misurati la tariffa piatta storica
  // resta un pavimento.
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
    requiresQuote: false,
  }
}

/** true se per questo paese la spedizione va quotata a mano, non incassata. */
export function shippingRequiresQuote(
  countryCode: string,
  policy: UncalibratedExtraEuPolicy = UNCALIBRATED_EXTRA_EU_POLICY,
): boolean {
  return calculateShipping(0, countryCode, policy).requiresQuote
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
