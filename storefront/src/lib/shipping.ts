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
 * Punti di prezzo e politica — decisi da Alessandro il 21/09/2026: questo file
 * li applica, non li sceglie.
 *   1. margine extra-UE 10% (`EXTRA_EU_MARGIN_RATE`): sul caso misurato CH
 *      47,72 di costo + 4,77 di margine = 52,49 EUR addebitati.
 *   2. le destinazioni extra-UE senza misura SI VENDONO, con un profilo
 *      prudenziale per paese che usa l'IVA all'importazione della destinazione:
 *      il profilo svizzero (8,1%) NON e' prudente per il Regno Unito (20%) ne'
 *      per la Norvegia (25%).
 *   3. pavimento `EXTRA_EU_MINIMUM_SHIPPING` (48,00) sulla spedizione
 *      addebitata extra-UE, applicato DOPO il calcolo, mai sotto.
 *   4. spedizione gratuita extra-UE inesistente e promo "spedizione gratuita"
 *      che non azzera la tariffa extra-UE.
 *   5. de minimis svizzera (IVA sotto CHF 5) SPENTA: l'IVA si addebita anche
 *      quando la dogana non la riscuoterebbe.
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
 * Zona commerciale storica dell'abbonamento. Comprende Svizzera e Norvegia
 * perche' la scala dei prezzi di un abbonamento e' un prodotto, non un confine
 * doganale. NON e' piu' usata per aprire nuove attivazioni (vedi
 * ZONE_COUNTRIES in subscription-plans.ts): resta come storia dei rinnovi gia'
 * attivi, che Alessandro tocca caso per caso.
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
   * Rimane per la politica `quote_required`; con la politica di default
   * (`conservative_profile`) non si presenta su nessuna destinazione ammessa.
   */
  requiresQuote: boolean
  /**
   * Pavimento di spedizione addebitata (`EXTRA_EU_MINIMUM_SHIPPING`). null
   * sulle zone senza dogana, dove non esiste.
   */
  minimumCharge: number | null
  /** true quando e' il pavimento (non la stima) a determinare `cost`. */
  minimumChargeApplied: boolean
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
 * Margine sopra il costo sdoganato, su ogni destinazione extra-UE.
 * Punto di prezzo deciso da Alessandro (21/09/2026): 10%. Un cuscinetto che
 * cresce col valore, come cresce il costo: a margine 0 basta uno scostamento di
 * calibrazione e si e' di nuovo sotto.
 */
export const EXTRA_EU_MARGIN_RATE = 0.10

/**
 * Parametri del collo di riferimento MISURATO (40x40x10 / 2,0 kg, Basel CH).
 * Sono la base di ogni profilo extra-UE finche' per quel paese non c'e' una
 * misura: stesso corriere, stessa assicurazione, stessa fee DDP, stessa
 * gestione, stesso residuo di sdoganamento.
 */
const REFERENCE_PARCEL = {
  carrier: 23.00,
  insuranceRate: 0.0404,
  fixedImportFee: 4.08,
  ddpFee: 4.96,
  handlingFee: 0.99,
} as const

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
 * di ognuna con `pipeline.py margini`). Costo e prezzo sono due cose diverse:
 * 47,72 e' il costo misurato, 52,49 il prezzo addebitato (costo + 10%).
 */
export const SWITZERLAND_PROFILE: ExtraEuProfile = {
  ...REFERENCE_PARCEL,
  dutyRate: 0,
  importVatRate: 0.081,
  // De minimis CH: nessuna IVA se l'imposta e' sotto CHF 5 (≈ CHF 62 di valore
  // complessivo). Tenuta SPENTA: la soglia in EUR dipende dal cambio, e
  // sbagliarla vuol dire spedire sotto costo. Da accendere con un cambio
  // confermato, non con un cambio stimato.
  importVatExemptBelow: null,
  marginRate: EXTRA_EU_MARGIN_RATE,
  // Mai gratuita: sopra soglia lo sdoganamento lo pagherebbe Foolish.
  freeAbove: null,
  freeShippingPromoAllowed: false,
  calibrated: true,
  source: 'misurato — CMS 31 Basel CH, collo 40x40x10 2,0 kg, merce 99,00 EUR (2026-09)',
}

/**
 * Profilo prudenziale per una destinazione extra-UE non ancora misurata.
 *
 * L'unico parametro che deve venire dal paese e' l'IVA all'importazione (e il
 * dazio, dove e' noto): il resto e' il collo di riferimento misurato. Non e'
 * una misura del paese — e' il numero piu' onesto disponibile finche' non c'e'
 * una spedizione reale da leggere. La misura (card t_089d1b01, registro
 * `pipeline.py margini`) sostituisce il profilo senza toccare altro: basta
 * rimpiazzare la voce in `LANDED_COST_COUNTRIES`.
 */
function prudentProfile(params: {
  importVatRate: number
  source: string
  dutyRate?: number
}): ExtraEuProfile {
  return {
    ...REFERENCE_PARCEL,
    dutyRate: params.dutyRate ?? 0,
    importVatRate: params.importVatRate,
    importVatExemptBelow: null,
    marginRate: EXTRA_EU_MARGIN_RATE,
    freeAbove: null,
    freeShippingPromoAllowed: false,
    calibrated: false,
    source: params.source,
  }
}

/**
 * Copertura per paese — la regola e' per paese, non un flat unico.
 *
 * `CH` e' l'unico profilo misurato. Gli altri paesi extra-UE ammessi hanno un
 * profilo prudenziale che usa l'**IVA all'importazione della destinazione**: e'
 * il punto tecnico che rende il pavimento una rete e non una soluzione. Con
 * l'8,1% svizzero anche a 48,00 EUR si resta sotto costo di 17,27 in GB e di
 * 24,53 in NO: li' la tariffa deve stare sopra il pavimento per costruzione.
 */
export const LANDED_COST_COUNTRIES: Partial<Record<AllowedShippingCountry, ExtraEuProfile>> = {
  CH: SWITZERLAND_PROFILE,

  // Regno Unito: import VAT 20% (aliquota standard); dazio 0 sotto £135.
  GB: prudentProfile({
    importVatRate: 0.20,
    source: 'prudenziale — non misurato: IVA all\'importazione UK 20%, resto dal collo di riferimento CH',
  }),
  // Norvegia: 25% (VOEC sui bassi valori).
  NO: prudentProfile({
    importVatRate: 0.25,
    source: 'prudenziale — non misurato: IVA all\'importazione NO 25%, resto dal collo di riferimento CH',
  }),
  // Stati Uniti: nessuna IVA all'importazione sotto gli 800 USD (de minimis).
  // Sopra quella soglia il pacco e' daziabile e le voci non sono modellate:
  // e' il paese dove il pavimento fa il lavoro (vedi nota di debolezza in
  // fondo al file).
  US: prudentProfile({
    importVatRate: 0,
    source: 'prudenziale — non misurato: nessuna IVA all\'importazione sotto gli 800 USD, resto dal collo di riferimento CH',
  }),
  // Canada: GST federale 5%, HST 13-15% secondo provincia. Si usa 13%.
  CA: prudentProfile({
    importVatRate: 0.13,
    source: 'prudenziale — non misurato: GST/HST 13%, resto dal collo di riferimento CH',
  }),
  // Australia: GST 10% sui beni importati.
  AU: prudentProfile({
    importVatRate: 0.10,
    source: 'prudenziale — non misurato: GST 10%, resto dal collo di riferimento CH',
  }),
  // Giappone: consumption tax 10%.
  JP: prudentProfile({
    importVatRate: 0.10,
    source: 'prudenziale — non misurato: consumption tax 10%, resto dal collo di riferimento CH',
  }),
  // Brasile: carico IVA/ICMS alto e variabile per stato. Si usa 25%.
  BR: prudentProfile({
    importVatRate: 0.25,
    source: 'prudenziale — non misurato: ICMS ~25%, resto dal collo di riferimento CH',
  }),
}

/**
 * Fallback per un codice paese extra-UE senza profilo dedicato.
 *
 * Non e' una destinazione vendibile (ALLOWED_SHIPPING_COUNTRIES non lo
 * contiene: il checkout la rifiuta prima di arrivare qui), quindi non deve
 * essere preciso — deve essere il piu' prudente: l'aliquota piu' alta fra i
 * profili, cosi' un errore di configurazione non diventa una spedizione sotto
 * costo.
 */
export const DEFAULT_EXTRA_EU_PROFILE: ExtraEuProfile = prudentProfile({
  importVatRate: 0.25,
  source: 'prudenziale — fallback generico, paese non mappato o non vendibile: non e\' una misura',
})

/**
 * Pavimento di spedizione addebitata su una destinazione extra-UE.
 * Deciso da Alessandro (21/09/2026): 48,00 EUR, mai meno, arrotondato per
 * eccesso. Si applica DOPO il calcolo, a OGNI destinazione extra-UE (compresa
 * la Svizzera misurata: sotto ~50 EUR di merce il costo stimato scende sotto
 * il pavimento e vince il pavimento — e' una politica di prezzo, non una
 * misura). Sul caso misurato non cambia nulla: 52,49 > 48,00.
 */
export const EXTRA_EU_MINIMUM_SHIPPING = 48.00

/**
 * Cosa fare con un paese extra-UE che non ha ancora una misura.
 *
 *   'conservative_profile'  (default, decisione di Alessandro 21/09/2026) si
 *                         vende col profilo prudenziale del paese — che usa
 *                         l'IVA all'importazione della destinazione — piu' il
 *                         pavimento `EXTRA_EU_MINIMUM_SHIPPING`.
 *   'quote_required'      non si vende a un prezzo non misurato: la spedizione
 *                         si quota a mano. Resta come rete di sicurezza per un
 *                         profilo che si rivelasse sbagliato: si attiva con
 *                         una riga e non spedisce affatto.
 */
export type UncalibratedExtraEuPolicy = 'quote_required' | 'conservative_profile'

export const UNCALIBRATED_EXTRA_EU_POLICY: UncalibratedExtraEuPolicy = 'conservative_profile'

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
      minimumCharge: null,
      minimumChargeApplied: false,
    }
  }

  const country = String(countryCode ?? '').toUpperCase() as AllowedShippingCountry
  const profile = LANDED_COST_COUNTRIES[country] ?? DEFAULT_EXTRA_EU_PROFILE

  // Paese extra-UE senza profilo misurato: la politica di default lo vende col
  // profilo prudenziale del paese; con 'quote_required' non si inventa un
  // numero e la spedizione si quota a mano.
  if (!profile.calibrated && policy === 'quote_required') {
    return {
      zone,
      cost: 0,
      freeAbove: null,
      isFree: false,
      landedCost: null,
      freeShippingPromoAllowed: false,
      requiresQuote: true,
      minimumCharge: null,
      minimumChargeApplied: false,
    }
  }

  const landed = calculateLandedCost(cartTotal, profile)

  // Guardia di accettazione: su extra-UE non si parte mai sotto il costo
  // sdoganato stimato. Il pavimento (`EXTRA_EU_MINIMUM_SHIPPING`) si applica
  // DOPO il calcolo, come ultima rete di sicurezza, su ogni destinazione
  // extra-UE: se ne sta sotto e' la stima a essere debole, e li' si addebita
  // di piu', non meno.
  const cost = Math.max(landed.total, EXTRA_EU_MINIMUM_SHIPPING)

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
    minimumCharge: EXTRA_EU_MINIMUM_SHIPPING,
    minimumChargeApplied: cost > landed.total,
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

/**
 * LIMITI DICHIARATI di questi profili — quello che il modello NON sa.
 *
 * 1. Collo di riferimento. `carrier` 23,00 e `insuranceRate` 4,04% sono del
 *    collo misurato (40x40x10 / 2,0 kg). Peso e volume non sono modellati: un
 *    collo piu' pesante o piu' ingombrante costa di piu', e una destinazione
 *    intercontinentale costa probabilmente piu' della Svizzera a parita' di
 *    collo. Il pavimento copre l'errore verso il basso, non lo elimina.
 * 2. `fixedImportFee` 4,08 e' il residuo misurato in Svizzera (i
 *    `customs_and_duties` che l'IVA 8,1% non spiega): usato come allowance di
 *    sdoganamento per gli altri paesi, dove non e' stato misurato.
 * 3. Dazi non modellati fuori dalla Svizzera (dove sono 0 per legge). In
 *    particolare gli Stati Uniti: sotto gli 800 USD il pacco non e' daziabile
 *    (e l'IVA all'importazione non esiste), sopra quella soglia scattano dazio
 *    e MPF, che qui non sono stimati: e' il caso che il pavimento solleva e che
 *    la misura deve sostituire.
 * 4. Aliquote dei profili prudenziali (GB 20%, NO 25%, CA 13%, AU 10%, JP 10%,
 *    BR 25%) sono aliquote di legge della destinazione, non misure: sono la
 *    parte che rende il profilo prudente invece che ottimista, e la prima cosa
 *    che la calibrazione sostituisce.
 *
 * Sostituire un profilo con la sua misura = rimpiazzare la voce in
 * `LANDED_COST_COUNTRIES` (card t_089d1b01) e rilanciare i test: nessun altro
 * punto del codice conosce i parametri.
 *
 * La base del calcolo puo' diventare una QUOTA REALE e non una stima: `alfred`
 * ha verificato il 21/09/2026 che `POST /pro/shipments/products` (DDP selezionato
 * + fattura doganale, fuori dal prefisso /v1) restituisce porterage,
 * management_fee, insurance, ddp_fee e customs_and_duties con il supplemento DDP
 * identico a quello poi addebitato (dettagli in DOGANA-OPERATIVA.md). Quando la
 * quota arriva, sostituisce il profilo del paese; il pavimento resta la rete di
 * sicurezza sotto di essa. Il costo dell'etichetta non entra mai nel checkout:
 * la chiave Packlink resta solo sulla Pi e qui non c'e' nessuna credenziale.
 */
