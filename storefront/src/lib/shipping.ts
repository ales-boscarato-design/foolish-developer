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
 * Sempre il 21/09/2026 Alessandro ha deciso cosa fare dei paesi senza misura: si
 * VENDONO, con l'aliquota IVA all'importazione DEL PAESE DI DESTINAZIONE (non
 * l'8,1% svizzero, che su GB/NO era sotto costo) e un pavimento di 48,00 EUR
 * sulla spedizione addebitata. Le aliquote sono regole di LEGGE, ognuna con la
 * sua fonte in DESTINATION_TAX_RULES; i dazi restano l'assunzione piu' debole
 * del modello e sono dichiarati uno per uno. Il Brasile e' l'unica eccezione:
 * resta in preventivo — nessun servizio dell'account sdoganA verso BR, e la
 * pipeline di spedizione blocca un pacco che partirebbe in DAP.
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
  /**
   * La regola che ha prodotto quel dazio: `flat` aliquota piatta su tutto il
   * valore, `relief` merce sotto la soglia di legge (dazio azzerato dal relief),
   * `above` merce sopra la soglia. Serve a leggere un preventivo — e a
   * distinguere «zero perche' la norma lo azzera» da «zero perche' nessuno l'ha
   * scritto» — senza rifare il calcolo a mano.
   */
  dutyBand: DutyBand
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
  /**
   * Totale della STIMA: costo sdoganato + margine, arrotondato per eccesso al
   * centesimo. NON include il pavimento dei paesi non misurati — quello lo
   * applica `calculateShipping`, e il prezzo addebitato al cliente e' sempre
   * `ShippingRate.cost` (merce 0 in GB: qui `total` = 33,04, `cost` = 48,00).
   */
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
   * true: la spedizione si quota a mano, non si incassa un prezzo stimato.
   * Vale quando la politica e' girata su 'quote_required' o quando il paese
   * non ha un profilo (nessuna linea DDP, oggi il Brasile). Dal 21/09/2026 il
   * default VENDE i paesi non misurati: qui true e' l'eccezione, non la regola.
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
  /**
   * Dazio all'importazione: quota sulla base CIF (merce + trasporto). E'
   * l'aliquota che vale SOTTO la soglia di `dutyAboveThreshold`, e su tutto il
   * valore quando la fascia non c'e'.
   */
  dutyRate: number
  /**
   * Fascia di dazio che scatta SOPRA una soglia di valore merce, quando sotto la
   * soglia il dazio e' azzerato da un relief di legge. Assente = nessuna soglia:
   * l'aliquota piatta `dutyRate` vale su tutto il valore. Vedi `importDuty`.
   */
  dutyAboveThreshold?: DutyAboveThreshold
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

/** Fascia che ha determinato il dazio: vedi `importDuty`. */
export type DutyBand = 'flat' | 'relief' | 'above'

/**
 * Fascia di dazio che scatta sopra una soglia di valore merce, quando sotto la
 * soglia il dazio e' azzerato da un relief di legge.
 *
 * Perche' la soglia sta nella valuta della legge e non in EUR: la norma la
 * scrive in sterline (£135), e il confronto va fatto li'. Portare la soglia in
 * EUR una volta per tutte la legherebbe a un cambio che nel codice non c'e', e
 * il giorno che il cambio si muove il confine della fascia si sposta senza che
 * nessuno lo veda. Qui il cambio e' DICHIARATO e datato (`foreignPerEur`),
 * quindi il confine e' riproducibile e si aggiorna in un punto solo.
 *
 * La soglia si confronta sul VALORE MERCE (il prezzo della merce venduta per
 * l'export, trasporto e assicurazione esclusi: e' la definizione di "intrinsic
 * value" del relief), non su merce + trasporto. Sono due grandezze diverse e un
 * carrello puo' avere la base doganale sopra soglia restando esente.
 */
export interface DutyAboveThreshold {
  /** Valore merce massimo (incluso) che resta esente, nella valuta della legge. */
  thresholdForeign: number
  /** Cambio dichiarato: quante unita' di valuta estera vale 1 EUR. */
  foreignPerEur: number
  /** Valuta della soglia (ISO 4217): si legge la soglia senza indovinarla. */
  currency: string
  /**
   * Aliquota applicata sopra la soglia, sulla base doganale. Una fascia a
   * aliquota zero non ha senso: sotto soglia c'e' gia' il relief.
   */
  dutyRate: number
  /** Fonte della soglia e dell'aliquota, con la data. Non e' una nostra misura. */
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
 * E non si ripiega sul DAP: la pipeline di spedizione ha `ddp: true` e BLOCCA
 * i servizi che non lo supportano (customs.json), quindi un ordine BR non
 * sarebbe spedibile. Si sblocca con una linea DDP verso BR, o con una scelta
 * esplicita di spedire in DAP — che cambia la promessa al cliente (dazi e IVA
 * li paga il destinatario) e va decisa, non dedotta dal codice.
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

/**
 * Parametri TECNICI condivisi dai paesi non misurati: assicurazione, spese di
 * sdoganamento, fee DDP, gestione. MISURATI su CH (ordine 31) e applicati agli
 * altri paesi come ASSUNZIONE dichiarata — non sono aliquote e non dipendono
 * dal paese: la quota assicurativa e' una regola di Packlink, la fee DDP e la
 * gestione sono i prezzi del nostro account, la spesa di sdoganamento e' il
 * disborso del corriere. Le ALIQUOTE per paese NON vengono da qui: stanno in
 * DESTINATION_TAX_RULES.
 */
export const DEFAULT_EXTRA_EU_PROFILE: ExtraEuProfile = {
  ...SWITZERLAND_PROFILE,
  calibrated: false,
  source: 'parametri tecnici misurati su CH, applicati a un paese non misurato',
}

/**
 * Regole FISCALI DEL PAESE DI DESTINAZIONE per i paesi che non hanno una misura
 * nostra. Sono aliquote di LEGGE, non misure: ognuna porta la sua fonte, ed e'
 * l'unica cosa che si puo' scrivere senza una spedizione DDP reale.
 *
 * Perche' l'aliquota del paese e non l'8,1% svizzero: gli oneri import in DDP
 * li paga Foolish, quindi applicare l'aliquota sbagliata non e' un dettaglio di
 * arrotondamento — con l'8,1% su una merce da 99,00 il Regno Unito ci costerebbe
 * 23,50 di IVA contro 9,52 incassati (~14 EUR di perdita per spedizione).
 *
 * scelta 2026-09-21 (Alessandro, via alfred): i paesi senza misura si VENDONO,
 * con l'aliquota del paese di destinazione e il pavimento di 48,00 EUR.
 *
 * ASSUNZIONE DICHIARATA sui dazi: i profili non misurati mettono il dazio a zero
 * tranne gli Stati Uniti. E' un'assunzione, non una misura — tranne GB, dove
 * l'azzeramento sotto soglia ha ora una base di legge ed e' scritto come fascia:
 *  - GB: dazio 0 sotto £135 di valore merce, per LEGGE e non per un accordo —
 *    relief «consignments containing goods of negligible value», §5 del
 *    «United Kingdom Customs Tariff: Reliefs from Import Duty» v1.8 («full
 *    relief in respect of goods of negligible value»; «the intrinsic value of
 *    the goods must not exceed £135», trasporto e assicurazione esclusi). Sopra
 *    la soglia il dazio e' quello di tariffa: 6,00% sulla resina (cod.
 *    3926909790) e 2,00% sulla pelle siliconica (cod. 4016999790), 4,42% in
 *    blend sulla composizione nota — in DDP lo paghiamo noi.
 *    NON e' il TCA a tenere il dazio a zero: la preferenza UE a 0,00% esiste in
 *    tariffa (SI 2020/1457) ma richiede una prova di origine che oggi NON
 *    viaggia con la fattura doganale (verifica 21/09/2026, t_73bfca79: nel PDF
 *    reale c'e' la colonna `Country of origin: IT`, non la formula di origine
 *    preferenziale, e il contratto della fattura doganale Packlink non ha un
 *    campo dove scriverla).
 *    ATTENZIONE — il relief e' in RIMOZIONE: GOV.UK, consultation response
 *    luglio 2026, nuove regole sull'LVI obbligatorie «by October 2028 at the
 *    latest». Da allora il dazio torna anche sotto £135 e l'unico modo di
 *    restare a zero e' lo statement on origin (materia del commercialista).
 *  - CH: zero dazi sui capitoli 25-97 dal 1/1/2024 — questo e' misurato.
 *  - NO/CA/AU/JP: il dazio dipende dal codice doganale e non e' mai stato
 *    misurato. NO (accordo SEE) ha dazio 0 CONDIZIONATO alla prova di origine,
 *    esattamente come GB: la stessa verifica e' aperta, e finche' non e' chiusa
 *    quel profilo resta un'assunzione. AU ha una franchigia di 1.000 AUD sul
 *    dazio, quindi a zero sotto quella soglia; sopra, il profilo non e' coperto.
 *  - US: nessuna IVA federale all'import, ma la franchise di 800 USD e' stata
 *    SOSPESA per tutti i paesi (EO 14324, 29/08/2025) e la sospensione e' stata
 *    prorogata dopo la sentenza IEEPA del 20/02/2026: OGGI ogni spedizione
 *    entra in dogana con dazio. La catena normativa e' instabile (IEEPA
 *    annullata -> Section 122 10% dal 24/02/2026 -> scaduta il 24/07/2026 ->
 *    Section 301 di sostituzione), i prodotti di origine UE restano sul tetto
 *    del 15% dell'accordo. Qui si applica il 15%: coerente con i due addebiti
 *    post-consegna MISURATI sul nostro account (+17,82 su 137,60 = 12,9% e
 *    +41,41 su 454,87 = 9,1% del valore + trasporto).
 */
export interface DestinationTaxRule {
  /** IVA all'importazione del paese di destinazione. 0 = non esiste (US). */
  importVatRate: number
  /** Dazio all'importazione. 0 = esente o non applicabile. */
  dutyRate: number
  /**
   * Fascia di dazio sopra una soglia di valore merce (relief di legge sotto la
   * soglia). Assente = l'aliquota piatta `dutyRate` vale su tutto il valore.
   */
  dutyAboveThreshold?: DutyAboveThreshold
  /** Fonte della regola: legge, con data. Non e' una nostra misura. */
  source: string
}

/**
 * Cambio di riferimento DICHIARATO: quanti GBP vale 1 EUR (Banca centrale
 * europea via frankfurter.dev, 18/09/2026 — 1 EUR = 0,8588 GBP). Sta in una
 * costante perche' la soglia del relief GB e' scritta in sterline: il confronto
 * si fa in GBP con questo numero, quindi aggiornare il cambio sposta il confine
 * della fascia in un punto solo. A questo cambio £135 ≈ 157,20 EUR di merce.
 */
export const GBP_PER_EUR = 0.8588

export const DESTINATION_TAX_RULES: Partial<Record<AllowedShippingCountry, DestinationTaxRule>> = {
  GB: {
    importVatRate: 0.20,
    // Lo zero NON viene dal TCA. La dichiarazione di origine UE non viaggia con
    // la fattura doganale (verifica 21/09/2026, t_73bfca79: nel PDF reale
    // dell'ordine 31 c'e' la colonna `Country of origin: IT`, non la formula di
    // origine preferenziale, e il contratto della fattura doganale Packlink non
    // ha nessun campo dove scriverla). Lo zero sta qui perche' sotto £135 di
    // valore merce il dazio UK e' azzerato da un RELIEF DI LEGGE — con o senza
    // dichiarazione di origine — ed e' la fascia in cui lo storefront vende.
    dutyRate: 0,
    // Sopra la soglia il relief non copre piu' niente e si applica il dazio di
    // tariffa, che in DDP paghiamo noi. La soglia e' in GBP e si confronta sul
    // valore merce (intrinsic value), non su merce + trasporto.
    dutyAboveThreshold: {
      thresholdForeign: 135,
      foreignPerEur: GBP_PER_EUR,
      currency: 'GBP',
      // 4,42% = blend sulla composizione misurata dell'ordine 31: 39,62% pelle
      // × 2,00% + 60,38% resina × 6,00% = 4,4152%, arrotondato in ECCESSO a
      // 4,42%: l'arrotondamento di un costo va verso l'alto, mai verso il
      // basso. LIMITE DICHIARATO: il mix e' dell'ordine, non per riga — un
      // carrello di sola resina paga il 6,00% e con questo blend resta scoperto
      // di 1,58 punti di base doganale. Il modello non risolve il mix per riga
      // e questa modifica non lo cambia.
      dutyRate: 0.0442,
      source: 'soglia £135 di valore merce: «United Kingdom Customs Tariff: Reliefs from Import Duty» v1.8, Section 5 «Consignments containing goods of negligible value» (§5.3: full relief dal dazio se l\'intrinsic value della merce non supera £135, trasporto e assicurazione esclusi); aliquota sopra soglia: UK Integrated Online Tariff cod. 3926909790 resina 6,00% e cod. 4016999790 pelle siliconica 2,00% (SI 2020/1430) — 4,42% in blend sulla composizione dell\'ordine 31 (39,62% pelle + 60,38% resina); soglia confrontata in GBP al cambio BCE 18/09/2026 (1 EUR = 0,8588 GBP: £135 = 157,20 EUR di merce); ATTENZIONE — il relief LVI e\' in rimozione: GOV.UK, consultation response luglio 2026, nuove regole obbligatorie «by October 2028 at the latest»',
    },
    source: 'IVA UK import 20% (standard rate, su valore + dazio + trasporto); dazio 0 sotto £135 di valore merce per il relief di §5 (UK Customs Tariff: Reliefs from Import Duty, consignments containing goods of negligible value) — NON per il TCA: la dichiarazione di origine UE non viaggia con la fattura doganale (verifica 21/09/2026, t_73bfca79). Sopra £135: UKGT 6,00% resina 3926909790 e 2,00% pelle siliconica 4016999790, 4,42% in blend (SI 2020/1430). Il relief e\' in rimozione: nuove regole LVI obbligatorie «by October 2028 at the latest» (GOV.UK consultation response, luglio 2026)',
  },
  NO: {
    importVatRate: 0.25,
    dutyRate: 0,
    source: 'MVA norvegese 25% su (merce + trasporto); soglia NOK 350 sul solo dazio, IVA dovuta dalla prima corona',
  },
  CA: {
    importVatRate: 0.15,
    dutyRate: 0,
    source: 'GST 5% federale + quota provinciale: HST fino al 15% (NB/NL/PE) — la provincia non e\' nota al checkout, si applica la MASSIMA',
  },
  AU: {
    importVatRate: 0.10,
    dutyRate: 0,
    source: 'GST 10% su (valore + trasporto + dazio); dazio 0 sotto 1.000 AUD di valore',
  },
  JP: {
    importVatRate: 0.10,
    dutyRate: 0,
    source: 'consumption tax 10% su (valore + dazio); franchigia JPY 10.000 non applicabile ai carrelli nostri',
  },
  US: {
    importVatRate: 0,
    dutyRate: 0.15,
    source: 'nessuna IVA federale all\'import; dazio 15% (tetto dell\'accordo UE-USA per i prodotti di origine UE) — la franchise 800 USD e\' sospesa dal 29/08/2025',
  },
}

/**
 * Profilo per un paese non misurato: parametri tecnici condivisi (misurati su
 * CH), trasporto della linea DDP-capace del paese e aliquote del paese di
 * destinazione — compresa la fascia di dazio sopra soglia, quando il paese ne ha
 * una (GB: relief sotto £135). null quando per quel paese manca una delle due
 * cose: senza linea DDP non c'e' un costo sdoganato da stimare (BR oggi).
 */
export function uncalibratedExtraEuProfile(country: AllowedShippingCountry): ExtraEuProfile | null {
  const line = DDP_CAPABLE_CARRIER[country]
  const tax = DESTINATION_TAX_RULES[country]
  if (!line || !tax) return null
  return {
    ...DEFAULT_EXTRA_EU_PROFILE,
    carrier: line.carrier,
    importVatRate: tax.importVatRate,
    dutyRate: tax.dutyRate,
    // La fascia non e' un parametro "tecnico" condiviso: o il paese ha una
    // soglia di legge, o non ce l'ha. Qui si copia, non si inventa.
    dutyAboveThreshold: tax.dutyAboveThreshold,
    source: `prudenziale — aliquote del paese di destinazione, oneri import NON misurati (${tax.source}); trasporto: ${line.source}`,
  }
}

/**
 * Pavimento della spedizione addebitata su un paese non misurato: 48,00 EUR,
 * deciso da Alessandro il 21/09/2026. Si applica DOPO il calcolo del costo
 * sdoganato, arrotondando per eccesso: sotto quella soglia il paese si vende
 * lo stesso, ma la spedizione non scende mai sotto il pavimento.
 *
 * Perche' non e' la vecchia tariffa piatta da 37,95: quella era un prezzo, non
 * una rete di sicurezza — si applicava a costo sdoganato ignorato. Questa e' un
 * minimo sopra una stima che esiste, e resta solo come rete finche' il paese
 * non ha una misura vera. Il pavimento NON si applica ai paesi misurati (CH:
 * 47,72 al punto misurato, che e' una misura e non si arrotonda a un prezzo).
 *
 * Non e' un prezzo di vendita: e' il punto sotto il quale una spedizione
 * extra-UE non parte, in attesa della quota DDP live servita dalla Pi.
 */
export const UNCALIBRATED_EXTRA_EU_FLOOR = 48.00

/**
 * Cosa fare con un paese extra-UE che non ha ancora una misura.
 *
 *   'destination_profile' (default) si vende con le aliquote del paese di
 *                         destinazione (DESTINATION_TAX_RULES) e il pavimento
 *                         di 48,00 EUR. Decisione di Alessandro del
 *                         21/09/2026: i paesi senza misura si vendono, e la
 *                         stima regge finche' il pavimento e' la rete di
 *                         sicurezza. Il trasporto e' misurato o preventivato,
 *                         gli oneri import sono di legge — non misurati.
 *   'quote_required'      si torna a non vendere a un prezzo non misurato: la
 *                         spedizione si quota a mano. E' l'interruttore
 *                         fail-closed, tenuto perche' una politica di prezzo
 *                         deve poter essere spenta con una riga.
 *
 * La scelta e' commerciale e ora e' presa: il default vende. Il Brasile resta
 * `quote_required` anche girando questa politica, perche' non ha alcuna linea
 * DDP — e non e' prudenza: la pipeline di spedizione blocca (customs.json,
 * `ddp: true`) un pacco che partirebbe in DAP, quindi vendere BR oggi vorrebbe
 * dire incassare un ordine che non si puo' spedire.
 */
export type UncalibratedExtraEuPolicy = 'quote_required' | 'destination_profile'

export const UNCALIBRATED_EXTRA_EU_POLICY: UncalibratedExtraEuPolicy = 'destination_profile'

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

/**
 * Dazio all'importazione di un collo, con la fascia che l'ha determinato.
 *
 *   'flat'   il profilo non ha una fascia: l'aliquota piatta vale su tutta la
 *            base doganale;
 *   'relief' la fascia c'e' e la merce sta sotto (o sulla) soglia: si applica
 *            l'aliquota piatta, che per GB e' 0 perche' la norma azzera il dazio
 *            su quella fascia;
 *   'above'  la fascia c'e' e la merce la supera: si applica l'aliquota della
 *            fascia, perche' il relief non copre piu' niente.
 *
 * Il confronto della soglia e' sul VALORE MERCE, nella valuta dichiarata dalla
 * fascia (per GB: sterline, al cambio dichiarato in `foreignPerEur`); il dazio
 * si applica invece sulla base doganale, merce + trasporto. Sono due basi
 * diverse di proposito: la soglia e' una franchigia sul valore della merce, il
 * dazio si calcola sul valore doganale.
 */
export function importDuty(
  goods: number,
  carrier: number,
  profile: ExtraEuProfile,
): { duty: number; band: DutyBand } {
  const band = profile.dutyAboveThreshold
  const dutyBase = goods + carrier
  if (!band) {
    return { duty: roundCents(dutyBase * profile.dutyRate), band: 'flat' }
  }
  const goodsForeign = goods * band.foreignPerEur
  if (goodsForeign > band.thresholdForeign) {
    return { duty: roundCents(dutyBase * band.dutyRate), band: 'above' }
  }
  return { duty: roundCents(dutyBase * profile.dutyRate), band: 'relief' }
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

  // Dazio: due letture, e la fascia decide quale (vedi `importDuty`). Senza
  // fascia e' l'aliquota piatta del profilo su tutta la base doganale; con la
  // fascia, sotto la soglia di VALORE MERCE vale l'aliquota piatta — zero per GB,
  // dove e' la norma ad azzerare il dazio — e sopra vale l'aliquota della fascia.
  const { duty, band: dutyBand } = importDuty(goods, carrier, profile)

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
    dutyBand,
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
  // sdoganato stimato. Per i paesi non misurati si applica DOPO il calcolo il
  // pavimento di 48,00 EUR (decisione di Alessandro, 21/09/2026), arrotondando
  // per eccesso: un totale sotto il pavimento diventa il pavimento, mai un
  // prezzo piu' basso. I paesi misurati non lo ricevono: una misura non si
  // arrotonda a un prezzo (CH resta 47,72 al punto misurato).
  const cost = profile.calibrated
    ? landed.total
    : cents(Math.max(landed.total, UNCALIBRATED_EXTRA_EU_FLOOR))

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
