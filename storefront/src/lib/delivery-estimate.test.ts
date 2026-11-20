import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  addItalianWorkingDays,
  deliveryEstimateAfterNetworkError,
  estimateCartDelivery,
  formatDeliveryDate,
} from './delivery-estimate'

/**
 * Le date attese qui sono scritte A MANO (giorno lavorativo dopo giorno
 * lavorativo, festivita' comprese): se le derivassi chiamando la stessa
 * funzione, il test direbbe soltanto che il codice e' d'accordo con se stesso.
 *
 * Tutti i casi iniettano `now`, quindi non dipendono dall'orologio della
 * macchina ne' dal giorno in cui girano.
 */

const noon = (iso: string) => new Date(iso)

test('cutoff 12:00 Europe/Rome: 11:59 parte oggi, 12:00 slitta (ora solare e ora legale)', () => {
  // Ora solare (CET, UTC+1): mercoledi' 18 novembre 2026.
  const winterBefore = estimateCartDelivery({ now: noon('2026-11-18T10:59:00Z'), country: 'IT', items: [] })
  assert.equal(winterBefore.date, '2026-11-20', '11:59 italiane = partenza mercoledi\' 18, +2 giorni lavorativi')
  assert.equal(winterBefore.zone, 'IT_EU')
  assert.equal(winterBefore.productionDays, 0)
  assert.equal(winterBefore.marginDays, 2)
  assert.equal(winterBefore.fallback, false)
  assert.equal(winterBefore.reason, 'ok')

  const winterAfter = estimateCartDelivery({ now: noon('2026-11-18T11:00:00Z'), country: 'IT', items: [] })
  assert.equal(winterAfter.date, '2026-11-23', '12:00 italiane = partenza giovedi\' 19, +2 giorni lavorativi')

  // Ora legale (CEST, UTC+2): mercoledi' 9 giugno 2027.
  const summerBefore = estimateCartDelivery({ now: noon('2027-06-09T09:59:00Z'), country: 'IT', items: [] })
  assert.equal(summerBefore.date, '2027-06-11')

  const summerAfter = estimateCartDelivery({ now: noon('2027-06-09T10:00:00Z'), country: 'IT', items: [] })
  assert.equal(summerAfter.date, '2027-06-14', 'venerdi\' 11 e lunedi\' 14: il weekend non conta')
})

test('ordine di venerdi\' dopo il cutoff e ordine nel weekend partono lunedi\'', () => {
  const fridayAfterCutoff = estimateCartDelivery({ now: noon('2026-11-20T11:30:00Z'), country: 'IT', items: [] })
  assert.equal(fridayAfterCutoff.date, '2026-11-25', 'partenza lunedi\' 23 + martedi\' 24 + mercoledi\' 25')

  const saturday = estimateCartDelivery({ now: noon('2026-11-21T09:00:00Z'), country: 'IT', items: [] })
  assert.equal(saturday.date, '2026-11-25')

  const sunday = estimateCartDelivery({ now: noon('2026-11-22T09:00:00Z'), country: 'IT', items: [] })
  assert.equal(sunday.date, '2026-11-25')
})

test('festivita\' fissa (8 dicembre 2026) e festivita\' mobile (Pasquetta 2027) vengono saltate', () => {
  const beforeImmacolata = estimateCartDelivery({ now: noon('2026-12-07T08:00:00Z'), country: 'IT', items: [] })
  assert.equal(beforeImmacolata.date, '2026-12-10', 'l\'8 dicembre non e\' un giorno lavorativo: 9 e 10 dicembre')

  const startingOnHoliday = estimateCartDelivery({ now: noon('2026-12-07T12:00:00Z'), country: 'IT', items: [] })
  assert.equal(startingOnHoliday.date, '2026-12-11', 'partenza l\'8 cade in festa: si parte il 9, poi 10 e 11')

  const easterMonday = estimateCartDelivery({ now: noon('2027-03-26T08:00:00Z'), country: 'IT', items: [] })
  assert.equal(easterMonday.date, '2027-03-31', 'Pasquetta 29 marzo saltata: 30 e 31 marzo')
})

test('fine mese e cambio d\'anno non inventano giorni lavorativi', () => {
  const endOfMonth = estimateCartDelivery({ now: noon('2026-11-30T08:00:00Z'), country: 'IT', items: [] })
  assert.equal(endOfMonth.date, '2026-12-02')

  const yearChange = estimateCartDelivery({ now: noon('2026-12-31T08:00:00Z'), country: 'IT', items: [] })
  assert.equal(yearChange.date, '2027-01-05', '1 gennaio festa, 2-3 weekend: 4 e 5 gennaio')
})

test('made-to-order con 5 giorni di produzione: partenza + 5 giorni lavorativi, poi il margine', () => {
  const estimate = estimateCartDelivery({
    now: noon('2026-11-18T08:00:00Z'),
    country: 'IT',
    items: [{ madeToOrder: true, productionDays: 5 }],
  })
  assert.equal(estimate.productionDays, 5)
  assert.equal(estimate.fallback, false)
  assert.equal(estimate.date, '2026-11-27', 'produzione 19,20,23,24,25 novembre; margine 26 e 27')
})

test('carrello misto: comanda l\'articolo piu\' lento (0, 3 e 8 giorni = 8)', () => {
  const estimate = estimateCartDelivery({
    now: noon('2026-11-18T08:00:00Z'),
    country: 'IT',
    items: [
      { madeToOrder: false, productionDays: 0 },
      { madeToOrder: true, productionDays: 3 },
      { madeToOrder: true, productionDays: 8 },
    ],
  })
  assert.equal(estimate.productionDays, 8)
  assert.equal(estimate.date, '2026-12-02', 'produzione 19,20,23,24,25,26,27,30 novembre; margine 1 e 2 dicembre')
})

test('zona: IT_EU margine 2 giorni, EXTRA_EU margine 6 giorni', () => {
  const now = noon('2026-11-18T08:00:00Z')
  const itEu = estimateCartDelivery({ now, country: 'IT', items: [] })
  assert.equal(itEu.zone, 'IT_EU')
  assert.equal(itEu.marginDays, 2)
  assert.equal(itEu.date, '2026-11-20')

  const extraEu = estimateCartDelivery({ now, country: 'US', items: [] })
  assert.equal(extraEu.zone, 'EXTRA_EU')
  assert.equal(extraEu.marginDays, 6)
  assert.equal(extraEu.date, '2026-11-26', 'sei giorni lavorativi dal 18: 19,20,23,24,25,26 novembre')

  // Un paese dell'Unione doganale e' IT_EU come l'Italia: la zona e' doganale,
  // non geografica.
  assert.equal(estimateCartDelivery({ now, country: 'DE', items: [] }).zone, 'IT_EU')
})

test('produzione sconosciuta: margine prudente +3 IT_EU e +7 EXTRA_EU, nessun numero inventato', () => {
  const now = noon('2026-11-18T08:00:00Z')
  const itEu = estimateCartDelivery({ now, country: 'IT', items: [{ madeToOrder: true, productionDays: null }] })
  assert.equal(itEu.zone, 'IT_EU')
  assert.equal(itEu.fallback, true)
  assert.equal(itEu.productionDays, null)
  assert.equal(itEu.marginDays, 3)
  assert.equal(itEu.reason, 'ok')
  assert.equal(itEu.date, '2026-11-23', 'tre giorni lavorativi: 19, 20 e 23 novembre')

  const extraEu = estimateCartDelivery({ now, country: 'US', items: [{ madeToOrder: true }] })
  assert.equal(extraEu.zone, 'EXTRA_EU')
  assert.equal(extraEu.fallback, true)
  assert.equal(extraEu.productionDays, null)
  assert.equal(extraEu.marginDays, 7)
  assert.equal(extraEu.date, '2026-11-27', 'sette giorni lavorativi: dal 19 al 27 novembre')
})

test('paese assente: nessuna zona, nessuna data, nessuna eccezione', () => {
  const now = noon('2026-11-18T08:00:00Z')
  for (const country of ['', '   ', null, undefined]) {
    const estimate = estimateCartDelivery({ now, country, items: [{ madeToOrder: true, productionDays: 3 }] })
    assert.deepEqual(estimate, {
      zone: null,
      productionDays: null,
      marginDays: null,
      fallback: false,
      departureDate: null,
      date: null,
      reason: 'zone_unknown',
    })
  }
})

test('durata di produzione fuori dal limite: out_of_bounds, nessun ciclo, nessuna eccezione', () => {
  const now = noon('2026-11-18T08:00:00Z')
  for (const productionDays of [3_651, 100_000, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const startedAt = Date.now()
    const estimate = estimateCartDelivery({ now, country: 'IT', items: [{ madeToOrder: true, productionDays }] })
    assert.deepEqual(estimate, {
      zone: 'IT_EU',
      productionDays: null,
      marginDays: null,
      fallback: false,
      departureDate: null,
      date: null,
      reason: 'out_of_bounds',
    })
    assert.ok(Date.now() - startedAt < 1_000, `durata non limitata per ${String(productionDays)}`)
  }
  // Il limitatore interno resta: nessuna data calcolata oltre il limite.
  assert.throws(() => addItalianWorkingDays(noon('2026-11-20T00:00:00Z'), 3_651), /bound/)
})

test('il calcolo non legge il fuso del processo: solo componenti Europe/Rome via Intl', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'delivery-estimate.ts'), 'utf8')
  assert.doesNotMatch(source, /\.get(Hours|Date|Month|FullYear)\(/, 'getter del fuso locale: la data cambierebbe con la macchina')
  assert.match(source, /timeZone:\s*ROME_TIME_ZONE/, 'l\'ora italiana deve venire da Intl, non dal fuso del processo')

  const emptyDateConstructions = [...source.matchAll(/new Date\(\)/g)]
  assert.equal(emptyDateConstructions.length, 1, 'l\'orologio si legge in un solo punto')
  for (const match of emptyDateConstructions) {
    const before = source.slice(Math.max(0, match.index! - 4), match.index)
    assert.match(before, /\?\?\s*$/, 'l\'unico orologio ammesso e\' il default del parametro `now`')
  }

  // Formattazione: il giorno e' un giorno di calendario in UTC, non un istante.
  assert.match(formatDeliveryDate('it-IT', noon('2026-11-24T00:00:00.000Z')), /martedì/i)
})

test('una stima non arrivata richiede conferma esplicita, senza data di ripiego', () => {
  assert.deepEqual(deliveryEstimateAfterNetworkError('IT|cart'), {
    key: 'IT|cart', date: null, productionDays: null, needsConfirmation: true,
  })
})

test('la frase della data esiste in tutte e cinque le lingue e non nasconde un intervallo', () => {
  const locales = ['it', 'en', 'de', 'fr', 'es']
  for (const locale of locales) {
    const messages = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as {
      checkout: { deliveryEstimate: unknown; deliveryEstimateConfirmChangedDate: unknown }
    }
    const text = messages.checkout.deliveryEstimate
    assert.equal(typeof text, 'string', `${locale}: manca checkout.deliveryEstimate`)
    assert.match(String(text), /\{date\}/, `${locale}: la frase deve portare la data`)
    // Un intervallo generico al posto della data sarebbe una promessa diversa
    // da quella calcolata qui, e nessuno se ne accorgerebbe.
    assert.doesNotMatch(String(text), /\d/, `${locale}: nessuna cifra scritta a mano al posto di {date}`)
    assert.equal(typeof messages.checkout.deliveryEstimateConfirmChangedDate, 'string', `${locale}: manca la conferma della data aggiornata`)
  }
})

test('pin della pagina checkout: niente quota senza paese, niente stima appesa, una sola data inviata', () => {
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', '[locale]', 'checkout', 'page.tsx'),
    'utf8',
  )

  // Il paese parte vuoto: e' "non scelto", non una destinazione.
  assert.match(page, /const \[country, setCountry\] = useState\(''\)/, 'country deve partire da stringa vuota')

  // La stima si ricarica solo al cambio di destinazione/carrello: niente polling.
  assert.doesNotMatch(page, /setInterval/, 'nessun polling: la pagina si ricarica solo su deliveryKey')

  // Quota extra-UE: senza paese `getShippingZone('')` cade su EXTRA_EU e
  // partirebbe una richiesta per una destinazione che non esiste.
  assert.match(
    page,
    /if \(!country \|\| !isExtraEuDestination \|\| items\.length === 0\) return/,
    'la quota non deve partire senza paese',
  )
  // Il blocco "da quotare" in pagina e' gated dal paese.
  assert.match(page, /country && baseShipping\.requiresQuote/, 'il blocco "da quotare" richiede un paese')

  // Si paga solo con paese scelto, stima risolta, nessuna conferma pendente e
  // nessuna stima nuova in attesa.
  const canPayStart = page.indexOf('const canPay =')
  const canPayEnd = page.indexOf('recipientNameComplete &&')
  assert.ok(canPayStart > 0 && canPayEnd > canPayStart, 'blocco canPay non trovato')
  const canPay = page.slice(canPayStart, canPayEnd)
  assert.match(canPay, /!!country/, 'canPay richiede il paese')
  assert.match(canPay, /estimateResolved/, 'canPay richiede la stima risolta')
  assert.match(canPay, /activeEstimate\?\.needsConfirmation !== true/, 'canPay blocca una conferma pendente')
  assert.match(canPay, /pendingForCart === null/, 'canPay blocca una stima in attesa')

  // La data che parte verso il checkout e' quella mostrata.
  assert.match(
    page,
    /deliveryEstimateDate: estimateResolved \? activeEstimateDate : undefined/,
    'si invia la data mostrata (o null quando la stima non ne produce una), non un ricalcolo',
  )

  // Una stima che non risponde non lascia il cliente appeso: abort dopo il
  // timeout e stesso percorso della stima assente (conferma esplicita).
  const estimateCallStart = page.indexOf("fetch('/api/stripe/delivery-estimate'")
  assert.ok(estimateCallStart > 0, 'chiamata della stima non trovata')
  const estimateCall = page.slice(estimateCallStart, estimateCallStart + 400)
  assert.match(estimateCall, /signal: controller\.signal/, 'la richiesta della stima deve poter essere annullata')
  assert.match(page, /setTimeout\(\(\) => controller\.abort\(\), 9_000\)/, 'la stima deve avere un timeout')
})

test("la partenza fa parte della stima: la data promessa si conta da li'", () => {
  // Giovedi' 19/11/2026, ore 10:00 italiane: prima del cutoff, quindi si parte
  // lo stesso giorno. Due giorni di produzione (ven 20, lun 23) piu' due di
  // margine (mar 24, mer 25): la data promessa e' mercoledi' 25.
  const estimate = estimateCartDelivery({
    now: new Date('2026-11-19T09:00:00.000Z'),
    country: 'IT',
    items: [{ madeToOrder: true, productionDays: 2 }],
  })
  assert.equal(estimate.departureDate, '2026-11-19')
  assert.equal(estimate.date, '2026-11-25')
  assert.equal(estimate.marginDays, 2)
})
