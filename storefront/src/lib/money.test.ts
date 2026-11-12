import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  EURO_SIGN,
  MONEY_LOCALES,
  MONEY_LOCALE_TAGS,
  eurosToDisplayCents,
  formatEuro,
  formatEuroCents,
  formatMoney,
  formatMoneyCents,
  formatWholeMoney,
  normalizeMoneyLocale,
} from './money'
import { resolveCheckoutCatalog } from './catalog'
import { buildStripeLineItems } from './checkout-session'
import {
  allocateProductDiscount,
  cartSubtotalCents,
  calculateServerShippingCostCents,
  moneyToCents,
} from './promo'
import { routing } from '../i18n/routing'

/**
 * Il difetto che questi test difendono (misurato il 12/11/2026 su `next start`
 * di build di produzione): ogni importo del checkout era reso con
 * `Number.prototype.toFixed(2)`, quindi il separatore decimale era il punto in
 * tutte e cinque le lingue — `Ajoutez 30.00€` su `/fr/checkout`, `€99.00` di
 * subtotale, `Paga 106.65€`. Italiano, francese, spagnolo e tedesco scrivono la
 * virgola.
 *
 * Qui si pinna anche la scelta unica sul simbolo: sta FUORI dal valore, dopo il
 * numero e senza spazio (`30,00€`), perche' e' cosi' che le frasi approvate nei
 * `messages/*.json` lo scrivono in tutte e cinque le lingue (`{amount}€`).
 * Se un giorno il simbolo entrasse nel valore formattato (`currency: 'EUR'`),
 * i test qui sotto lo dicono: `€` prefisso, oppure `€€` nei messaggi.
 */

const CHECKOUT_SOURCE = path.join(
  process.cwd(),
  'src',
  'app',
  '[locale]',
  'checkout',
  'page.tsx',
)

function readMessages(locale: string): Record<string, unknown> {
  const file = path.join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
}

function flatten(node: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      flatten(value, prefix ? `${prefix}.${key}` : key, out)
    }
  } else if (typeof node === 'string') {
    out[prefix] = node
  }
  return out
}

// ---------------------------------------------------------------- separatore

test('il separatore decimale e quello delle migliaia sono quelli della lingua', () => {
  // I soldi del carrello arrivano in euro come float (non stringhe): 30, 99,
  // 106.65, 37.65. Con la virgola in it/fr/es/de e col punto in inglese.
  assert.equal(formatMoney('it', 30), '30,00')
  assert.equal(formatMoney('en', 30), '30.00')
  assert.equal(formatMoney('fr', 30), '30,00')
  assert.equal(formatMoney('es', 30), '30,00')
  assert.equal(formatMoney('de', 30), '30,00')

  assert.equal(formatMoney('it', 106.65), '106,65')
  assert.equal(formatMoney('en', 106.65), '106.65')
  assert.equal(formatMoney('de', 37.65), '37,65')

  // Sopra il migliaio il raggruppamento segue la lingua: punto in it/de/es,
  // virgola in inglese, spazio (in francese tipograficamente stretto) in fr.
  assert.equal(formatMoney('it', 1234.5), '1.234,50')
  assert.equal(formatMoney('de', 1234.5), '1.234,50')
  assert.equal(formatMoney('es', 1234.5), '1.234,50')
  assert.equal(formatMoney('en', 1234.5), '1,234.50')
  assert.match(formatMoney('fr', 1234.5), /^1\s234,50$/, 'spazio delle migliaia in francese')
  // Il raggruppamento parte da mille in tutte le lingue, non da diecimila
  // come farebbe il default CLDR italiano: lo stesso importo non deve
  // cambiare forma cambiando pagina.
  assert.equal(formatMoney('it', 1000), '1.000,00')
  assert.equal(formatMoney('en', 1000), '1,000.00')
})

test('importi di confine: zero, mezzo euro, valori gia arrotondati, negativo', () => {
  assert.equal(formatMoney('it', 0), '0,00')
  assert.equal(formatMoney('en', 0), '0.00')
  assert.equal(formatMoney('it', 0.5), '0,50')
  assert.equal(formatMoney('en', 0.5), '0.50')
  // Un valore gia' a due decimali non si muove: e' il caso di ogni importo
  // che il carrello produce oggi.
  assert.equal(formatMoney('it', 99), '99,00')
  assert.equal(formatMoney('it', 7.65), '7,65')
  assert.equal(formatMoney('it', 999.99), '999,99')
  assert.equal(formatMoney('de', 14.99), '14,99')
})

test('la formattazione non sposta di un centesimo cio che il cliente pagava ieri', () => {
  // La prova e' il confronto con la vecchia resa: si tolgono i separatori di
  // gruppo dal valore formattato e si pretende la STESSA sequenza di cifre che
  // dava `toFixed(2)` — su OGNI valore, mezzi centesimi compresi: il numero in
  // pagina non si muove di un centesimo, cambiano solo i separatori.
  const corpus = [
    0, 0.5, 1, 7.65, 14.99, 30, 37.65, 99, 106.65, 999.99, 1234.5,
    8.125 * 50, 0.1 + 0.2, 30.000000000000004, 0.07 * 3,
    // mezzi centesimi: qui `Intl` da solo arrotonderebbe diversamente da
    // `toFixed` (2.675 -> 2,68 contro 2.67), e la pagina non deve cambiare
    // numero mentre cambia lingua.
    1.005, 2.675, 1.335, 0.105, 2.625,
  ]
  for (const amount of corpus) {
    const expectedDigits = amount.toFixed(2).replace(/\D/g, '')
    for (const locale of MONEY_LOCALES) {
      const actualDigits = formatMoney(locale, amount).replace(/\D/g, '')
      assert.equal(
        actualDigits,
        expectedDigits,
        `${locale} ${amount}: ${formatMoney(locale, amount)} non ha le cifre di ${amount.toFixed(2)}`,
      )
    }
  }
  // Il caso che discrimina: se qualcuno affidasse l'arrotondamento a `Intl`
  // invece che a `toFixed`, questo valore diventerebbe `2,68` e il test
  // rosseggia.
  assert.equal(formatMoney('it', 2.675), '2,67')
})

// ------------------------------------------------------------- simbolo euro

test('il simbolo sta dopo il numero, senza spazio, in tutte e cinque le lingue', () => {
  assert.equal(EURO_SIGN, '€')
  assert.equal(formatEuro('it', 30), '30,00€')
  assert.equal(formatEuro('en', 30), '30.00€')
  assert.equal(formatEuro('fr', 30), '30,00€')
  assert.equal(formatEuro('es', 30), '30,00€')
  assert.equal(formatEuro('de', 30), '30,00€')
  // Mai prefisso: sarebbe la seconda forma, quella che il messaggio approvato
  // non usa.
  for (const locale of MONEY_LOCALES) {
    assert.ok(!formatEuro(locale, 30).startsWith('€'), `${locale}: simbolo in testa`)
  }
})

test('le lingue dell helper sono quelle pubblicate dal routing', () => {
  // Se una lingua entra in `src/i18n/routing.ts` e non qui, il suo checkout
  // mostrerebbe importi in formato italiano senza che nulla fallisca: la
  // lista non si ricopia, si confronta.
  assert.deepEqual([...MONEY_LOCALES], [...routing.locales])
})

// ------------------------------------------------------------- locale e NaN

test('una lingua non pubblicata ricade sul default di routing (it)', () => {
  assert.equal(normalizeMoneyLocale('it-IT'), 'it')
  assert.equal(normalizeMoneyLocale('EN'), 'en')
  assert.equal(normalizeMoneyLocale('de-CH'), 'de')
  assert.equal(normalizeMoneyLocale('pt'), 'it')
  assert.equal(normalizeMoneyLocale(undefined), 'it')
  assert.equal(formatMoney('pt-BR', 1234.5), '1.234,50')
})

test('un importo non finito si ferma invece di mostrare un numero inventato', () => {
  assert.throws(() => formatMoney('it', Number.NaN), TypeError)
  assert.throws(() => formatMoney('it', Number.POSITIVE_INFINITY), TypeError)
  assert.throws(() => formatEuro('en', Number.NEGATIVE_INFINITY), TypeError)
  // Il tipo sbagliato (stringa da un JSON non validato) non deve formattare.
  assert.throws(() => formatMoney('it', '30' as unknown as number), TypeError)
})

// ---------------------------------------------------- locale esplicito, non di sistema

test('ogni lingua ha il suo locale esplicito: nessun Intl che indovina la macchina', () => {
  // La decisione, pinnata: it -> it-IT, en -> en-GB, fr -> fr-FR, es -> es-ES,
  // de -> de-DE. `Intl.NumberFormat(undefined, ...)` prenderebbe la lingua del
  // sistema e in SSR potrebbe dare un risultato diverso dal browser (hydration
  // mismatch); una lingua nuda (`en`) lascerebbe a CLDR la scelta della regione.
  assert.deepEqual(MONEY_LOCALE_TAGS, {
    it: 'it-IT',
    en: 'en-GB',
    fr: 'fr-FR',
    es: 'es-ES',
    de: 'de-DE',
  })
  // Le lingue del negozio e i tag non possono divergere: una lingua aggiunta a
  // `routing.locales` senza tag mostrerebbe importi in formato italiano.
  assert.deepEqual(Object.keys(MONEY_LOCALE_TAGS).sort(), [...MONEY_LOCALES].sort())
  // La resa e' quella del tag esplicito, non quella che `Intl` sceglierebbe da
  // solo: si confronta con un formattatore costruito sul tag.
  for (const locale of MONEY_LOCALES) {
    const reference: Intl.NumberFormat = new Intl.NumberFormat(MONEY_LOCALE_TAGS[locale], {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: true,
    })
    assert.equal(
      formatMoneyCents(locale, 123456),
      reference.format(1234.56),
      `${locale}: la resa non e' quella di ${MONEY_LOCALE_TAGS[locale]}`,
    )
  }
})

// ------------------------------------------------------------ importi tondi

test('un importo tondo si scrive senza decimali, con i tag espliciti della lingua', () => {
  // La soglia della spedizione gratuita e' una promessa tonda: il badge dice
  // «Gratis sopra 60€», non «60,00€». Ma il formato resta quello di questa
  // autorita': stesso tag esplicito, stesso raggruppamento. La variante a zero
  // decimali esiste perche' un importo che non e' un prezzo non deve leggersi
  // come un prezzo.
  for (const locale of MONEY_LOCALES) {
    assert.equal(formatWholeMoney(locale, 60), '60', `${locale}: sessanta`)
    assert.equal(formatWholeMoney(locale, 150), '150', `${locale}: centocinquanta`)
    const reference: Intl.NumberFormat = new Intl.NumberFormat(MONEY_LOCALE_TAGS[locale], {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      useGrouping: true,
    })
    assert.equal(
      formatWholeMoney(locale, 1234),
      reference.format(1234),
      `${locale}: la resa tonda non e' quella di ${MONEY_LOCALE_TAGS[locale]}`,
    )
  }
  // Il raggruppamento e' quello della lingua (non quello del sistema): lo stesso
  // 1234 ha la stessa forma tonda e a due decimali.
  assert.equal(formatWholeMoney('it', 1234), '1.234')
  assert.equal(formatWholeMoney('en', 1234), '1,234')
  assert.equal(formatWholeMoney('de', 1234), '1.234')
  // Una lingua non pubblicata ricade sul default di routing, mai su `undefined`.
  assert.equal(formatWholeMoney('xx', 60), '60')
  assert.equal(formatWholeMoney(undefined, 60), '60')
})

test('un importo con centesimi si ferma: non si arrotonda a una promessa tonda', () => {
  // Se una soglia diventasse 59,90 il badge non deve scrivere «60» (una promessa
  // piu' larga di quella vera): chi ha centesimi usa `formatMoney`. Il controllo
  // e' sul valore in ingresso, quindi anche 59,999 si ferma invece di essere
  // arrotondato ai centesimi e poi all'euro.
  assert.throws(() => formatWholeMoney('it', 59.9), /non intero/)
  assert.throws(() => formatWholeMoney('it', 0.01), /non intero/)
  assert.throws(() => formatWholeMoney('it', 59.999), /non intero/)
  assert.throws(() => formatWholeMoney('it', Number.NaN), /non intero/)
  assert.throws(() => formatWholeMoney('it', Number.POSITIVE_INFINITY), /non intero/)
})

test('i formattatori si costruiscono dal tag esplicito, mai dalla lingua nuda', () => {
  // Le cinque lingue rendono uguale con la lingua nuda e con il tag su un
  // importo tondo (`it` e `it-IT` danno `60`), quindi nessun confronto di
  // stringhe puo' accorgersi che i tag espliciti sono spariti: la regressione
  // che questa PR chiude si vede solo sul sorgente. Questo test la chiude nel
  // file che ora e' l'unica autorita' del formato.
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'money.ts'), 'utf8')

  const tagged = source.match(/new Intl\.NumberFormat\(MONEY_LOCALE_TAGS\[locale\],/g) ?? []
  assert.equal(
    tagged.length,
    2,
    'i due formattatori (2 decimali e importo tondo) devono costruirsi dal tag esplicito',
  )
  // Nessuna terza strada: il file costruisce esattamente due formattatori, e
  // ogni menzione di `Intl.NumberFormat(` e' una di quelle due costruzioni
  // (quindi nessuna chiamata senza `new`, ammessa da ES2020). Il sorgente e'
  // letto GREZZO, commenti compresi: un filtro che scarta righe puo' nascondere
  // codice vero (una riga `*` e' un metodo generatore valido).
  const constructed = source.match(/new Intl\.NumberFormat\(/g) ?? []
  const mentioned = source.match(/Intl\.NumberFormat\(/g) ?? []
  assert.equal(
    constructed.length,
    2,
    'money.ts non deve costruire altri formattatori oltre ai due (2 decimali e importo tondo)',
  )
  assert.equal(
    mentioned.length,
    constructed.length,
    'nessun `Intl.NumberFormat(...)` chiamato senza `new`: sarebbe un terzo formattatore invisibile',
  )
  // Nessun `NumberFormat` fuori da `Intl.NumberFormat`: blocks destructuring e
  // alias (`const { NumberFormat } = Intl`), che il conteggio qui sopra non vede.
  const bareNumberFormat = source.match(/(?<!Intl\.)\bNumberFormat\b/g) ?? []
  assert.equal(
    bareNumberFormat.length,
    0,
    'nessun `NumberFormat` fuori da `Intl.NumberFormat`: niente destrutturazione, niente alias',
  )
  assert.ok(
    !/globalThis|\bIntl\s*\[/.test(source),
    'il formattatore non si raggiunge per vie indirette (`globalThis`, accesso con parentesi quadre)',
  )
})

// ------------------------------------------------------- centesimi interi

test('l importo mostrato nasce da centesimi interi', () => {
  // La conversione euro -> centesimi del testo, agli stessi confini del resto
  // della suite: zero, mezzo euro, mille, un valore gia' a due decimali.
  assert.equal(eurosToDisplayCents(0), 0)
  assert.equal(eurosToDisplayCents(0.5), 50)
  assert.equal(eurosToDisplayCents(30), 3000)
  assert.equal(eurosToDisplayCents(1000), 100000)
  assert.equal(eurosToDisplayCents(1234.56), 123456)
  assert.equal(eurosToDisplayCents(-7.65), -765)

  assert.equal(formatMoneyCents('it', 0), '0,00')
  assert.equal(formatMoneyCents('en', 0), '0.00')
  assert.equal(formatMoneyCents('it', 50), '0,50')
  assert.equal(formatMoneyCents('en', 50), '0.50')
  assert.equal(formatMoneyCents('it', 100000), '1.000,00')
  assert.equal(formatMoneyCents('en', 100000), '1,000.00')
  assert.equal(formatMoneyCents('de', 100000), '1.000,00')
  assert.equal(formatMoneyCents('it', 123456), '1.234,56')
  assert.equal(formatEuroCents('it', 123456), '1.234,56€')
  assert.equal(formatEuroCents('en', 123456), '1,234.56€')
})

test('euro e centesimi sono la stessa autorita: due strade, la stessa stringa', () => {
  const corpus = [0, 0.5, 7.65, 14.99, 30, 37.65, 99, 106.65, 999.99, 1000, 1234.56, 2.675, 1.005]
  for (const amount of corpus) {
    for (const locale of MONEY_LOCALES) {
      assert.equal(
        formatEuroCents(locale, eurosToDisplayCents(amount)),
        formatEuro(locale, amount),
        `${locale} ${amount}: le due strade divergono`,
      )
      assert.equal(
        formatMoneyCents(locale, eurosToDisplayCents(amount)),
        formatMoney(locale, amount),
        `${locale} ${amount}: le due strade divergono`,
      )
    }
  }
  // Un centesimo frazionario e' un errore di programmazione, non un prezzo:
  // `Intl` non deve decidere una cifra che il calcolo non ha prodotto.
  assert.throws(() => formatMoneyCents('it', 30.5), TypeError)
  assert.throws(() => formatEuroCents('it', Number.NaN), TypeError)
  assert.throws(() => formatEuroCents('it', '3000' as unknown as number), TypeError)
  assert.throws(() => eurosToDisplayCents(Number.POSITIVE_INFINITY), TypeError)
})

// ------------------------------------------------------- confine con Stripe

const CHECKOUT_SESSION_SOURCE = path.join(process.cwd(), 'src', 'lib', 'checkout-session.ts')
const STRIPE_CHECKOUT_ROUTE_SOURCE = path.join(
  process.cwd(),
  'src',
  'app',
  'api',
  'stripe',
  'checkout',
  'route.ts',
)
const MONEY_SOURCE = path.join(process.cwd(), 'src', 'lib', 'money.ts')

test('1.234,56 scritto in pagina e 123456 centesimi verso Stripe: lo stesso numero', async () => {
  // Il percorso vero, non una fixture: il catalogo risolve il prezzo del CMS in
  // centesimi (`resolveCheckoutCatalog`), lo sconto si alloca e la spedizione
  // si calcola con le funzioni che il checkout chiama davvero, e le righe si
  // costruiscono con il builder che finisce in `line_items`.
  const resolved = await resolveCheckoutCatalog(
    [{ productId: 'product-1234', sku: 'SKU-1234', quantity: 1 }],
    {
      fetchProduct: async () => ({
        status: 'found' as const,
        product: {
          id: 'product-1234',
          name: 'Braccio iperrealistico',
          active: true,
          variants: [{ sku: 'SKU-1234', label: 'XS', price: 1234.56, stockStatus: 'available' }],
        },
      }),
    },
  )
  assert.equal(resolved.status, 'ok')
  if (resolved.status !== 'ok') return

  const subtotalCents = cartSubtotalCents(resolved.items)
  assert.ok(subtotalCents !== null, 'il subtotale in centesimi non e stato calcolato')
  assert.equal(subtotalCents, 123456)
  assert.ok(Number.isSafeInteger(subtotalCents))

  // Lo STESSO intero che il cliente legge, nelle due lingue.
  assert.equal(formatEuroCents('it', subtotalCents), '1.234,56€')
  assert.equal(formatEuroCents('en', subtotalCents), '1,234.56€')

  // Lo sconto (123,45 €) si alloca sulle righe prodotto, la spedizione e' la
  // tariffa del corriere: entrambe in centesimi interi.
  const discountCents = 12345
  const chargedLines = allocateProductDiscount(resolved.items, discountCents)
  assert.ok(chargedLines !== null, 'lo sconto non si alloca')
  const shippingCents = calculateServerShippingCostCents(resolved.items, 'IT', false)
  assert.ok(shippingCents !== null, 'la spedizione non si calcola')

  const lineItems = buildStripeLineItems(chargedLines, shippingCents)
  for (const line of lineItems) {
    assert.ok(
      Number.isInteger(line.price_data.unit_amount) && line.price_data.unit_amount > 0,
      `unit_amount non intero verso Stripe: ${String(line.price_data.unit_amount)}`,
    )
  }
  const chargedCents = lineItems.reduce((sum, line) => sum + line.price_data.unit_amount * line.quantity, 0)
  assert.ok(Number.isSafeInteger(chargedCents))
  assert.equal(chargedCents, subtotalCents - discountCents + shippingCents)
  // Il pagamento arrotonda con la regola del server (`Math.round`), non con
  // quella del testo: sul valore a due decimali le due coincidono, ed e' per
  // questo che il numero mostrato e quello incassato sono lo stesso.
  assert.equal(moneyToCents(1234.56), 123456)
})

test('le righe Stripe si costruiscono dai centesimi, mai da una stringa formattata', () => {
  const builder = fs.readFileSync(CHECKOUT_SESSION_SOURCE, 'utf8')
  const unitAmounts = builder
    .split('\n')
    .map((line) => line.trim())
    // Le assegnazioni: la dichiarazione di tipo (`unit_amount: number` nella
    // `interface`) non e' un valore inviato.
    .filter((line) => line.startsWith('unit_amount:') && line.endsWith(','))
  // Una sola forma ammessa: il campo in centesimi che il calcolo produce. Se
  // comparisse `Math.round(total * 100)` su un totale del browser, o
  // `Number(formatEuro(...))`, questa lista cambierebbe e il test lo dice.
  assert.deepEqual(unitAmounts, [
    'unit_amount: item.unitAmountCents,',
    'unit_amount: shippingCostCents,',
  ])
  for (const forbidden of ['parseFloat', 'parseInt', 'toFixed', 'formatEuro', 'formatMoney']) {
    assert.ok(
      !builder.includes(forbidden),
      `checkout-session.ts contiene ${forbidden}: il payload nasce dai centesimi, non dal testo`,
    )
  }

  const route = fs.readFileSync(STRIPE_CHECKOUT_ROUTE_SOURCE, 'utf8')
  assert.ok(
    route.includes('buildStripeLineItems(chargedProductLines, shippingCostCents)'),
    'la rotta non costruisce piu le righe dal builder condiviso: la guardia non coprirebbe il payload',
  )
  for (const forbidden of ['parseFloat', 'toFixed', 'formatEuro', 'formatMoney']) {
    assert.ok(!route.includes(forbidden), `stripe/checkout/route.ts contiene ${forbidden}`)
  }
})

test('nessun importo formattato torna a essere un numero', () => {
  // La ragione, misurata: la virgola non e' un separatore decimale per JS.
  assert.ok(Number.isNaN(Number('30,00')))
  assert.ok(Number.isNaN(Number('1.234,56')))
  assert.equal(Number('30.00'), 30)

  // E la regola nel codice: l'helper non espone nessun lettore di stringhe, e
  // la pagina non ri-analizza cio' che ha formattato (un `parseFloat` o un
  // `Number(formatEuro(...))` sarebbero il bug servito con un'altra faccia).
  const moneySource = fs.readFileSync(MONEY_SOURCE, 'utf8')
  assert.ok(
    !/parseFloat|parseInt/.test(moneySource),
    'money.ts legge stringhe: un importo formattato non e una fonte',
  )
  const page = fs.readFileSync(CHECKOUT_SOURCE, 'utf8')
  assert.ok(!/parseFloat\s*\(/.test(page), 'checkout/page.tsx rilegge un importo: il testo non e una fonte')
  assert.ok(
    !/Number\s*\(\s*(?:formatMoney|formatEuro)/.test(page),
    'checkout/page.tsx converte un importo formattato con Number()',
  )
  // Il corpo che il checkout manda al server porta i numeri con cui la pagina
  // calcola (il server li ignora e ricalcola dal catalogo), non stringhe.
  assert.match(page, /shippingCost: displayShippingCost,/)
  assert.match(page, /total: grandTotal,/)
})

// --------------------------------------------------- messaggi: nessun importo

/**
 * Due chiavi della pagina Pro scrivono ancora la soglia a mano («20% da 400€»,
 * e in inglese «€400» col simbolo in testa). NON sono il checkout e non si
 * correggono qui: sono elencate per nome, cosi' un importo scritto a mano che
 * comparisse ALTROVE fa fallire il test, e quando la pagina Pro verra'
 * sistemata queste due righe si tolgono. L'eccezione e' per chiave e vale in
 * tutte le lingue: dentro queste due il test non guarda.
 */
const KNOWN_HAND_WRITTEN_AMOUNTS = new Set([
  'pro.benefit1.title',
  'pro.card.benefit2',
])

/**
 * Un importo in chiaro: cifre attaccate al simbolo (in testa o in coda) oppure
 * la parola, nelle due forme che una traduzione usa davvero — «30 euro» e
 * «EUR 30». Il posto di un importo e' `{amount}`, non una cifra.
 */
const HAND_WRITTEN_AMOUNT = /(?:\d[\d.,]*\s*€)|(?:€\s*\d)|(?:\d[\d.,]*\s*euros?\b)|(?:\bEUR\s*\d)/i

test('nessun importo scritto a mano nei messaggi, fuori dalle due chiavi note', () => {
  const offenders: string[] = []
  for (const locale of MONEY_LOCALES) {
    const flat = flatten(readMessages(locale))
    for (const [key, value] of Object.entries(flat)) {
      if (!HAND_WRITTEN_AMOUNT.test(value)) continue
      if (KNOWN_HAND_WRITTEN_AMOUNTS.has(key)) continue
      offenders.push(`${locale}.${key} = ${value}`)
    }
  }
  assert.deepEqual(offenders, [], `importi scritti a mano nei messaggi:\n${offenders.join('\n')}`)
})

test('le chiavi di soldi del checkout portano il segnaposto, e il simbolo e in coda', () => {
  const moneyKeys = ['freeShippingAdd', 'labelFreeAbove', 'pay']
  for (const locale of MONEY_LOCALES) {
    const flat = flatten(readMessages(locale))
    for (const key of moneyKeys) {
      const value = flat[`checkout.${key}`]
      assert.equal(typeof value, 'string', `${locale}: checkout.${key} assente`)
      assert.ok(value.includes('{amount}'), `${locale}: checkout.${key} non ha {amount}`)
      assert.ok(value.includes('{amount}€'), `${locale}: checkout.${key} non scrive {amount}€`)
      assert.ok(
        !value.includes('€{amount}'),
        `${locale}: checkout.${key} mette il simbolo in testa — forma diversa dal resto del negozio`,
      )
    }
  }
})

// ------------------------------------------------------- la pagina di checkout

test('il checkout non formatta piu gli importi con toFixed', () => {
  const source = fs.readFileSync(CHECKOUT_SOURCE, 'utf8')
  // La guardia e' sul numero mostrato: `toFixed` resta legittimo nei calcoli
  // server-side, ma non nella pagina che il cliente legge.
  assert.ok(
    !source.includes('toFixed(2)'),
    'checkout/page.tsx formatta ancora importi con toFixed(2): usare @/lib/money',
  )
  assert.ok(
    source.includes("from '@/lib/money'"),
    'checkout/page.tsx non importa l\'helper condiviso @/lib/money',
  )
})

test('il checkout non compone euro a mano e non formatta da solo', () => {
  const lines = fs.readFileSync(CHECKOUT_SOURCE, 'utf8').split('\n')

  // 1. Il simbolo: nella pagina non c'e' NESSUN `€` letterale — lo aggiunge
  // `formatEuro` (o arriva dalla frase approvata nei messaggi). Questa forma
  // prende anche le scritture che una guardia sui prefissi lascerebbe passare:
  // `'€' + formatMoney(...)`, `{'€'}{formatMoney(...)}`, `<span>€</span>{...}`.
  const euroLines = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.includes('€'))
  assert.deepEqual(
    euroLines.map((l) => `${l.number}: ${l.line.trim()}`),
    [],
    'euro composti a mano nel checkout: il simbolo lo mette formatEuro, o e\' gia\' nella frase',
  )

  // 2. Nessun formattatore locale scritto in pagina: la formattazione sta in
  // un posto solo, altrimenti il prossimo importo nasce con `de-DE` fisso.
  const localFormatters = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /Intl\.NumberFormat|toLocaleString\s*\(/.test(line))
  assert.deepEqual(
    localFormatters.map((l) => `${l.number}: ${l.line.trim()}`),
    [],
    'formattazione di numeri scritta in pagina: usare @/lib/money',
  )

  // 3. `formatEuro`/`formatEuroCents` mai passati a una frase che ha gia' il
  // suo `€`: il messaggio e' `... {amount}€`, quindi li' va `formatMoney`, che
  // restituisce il solo numero, altrimenti il cliente legge `106,65€€`. E'
  // esattamente l'incidente che il merge con #62 puo' produrre, e nessun altro
  // test lo vedrebbe.
  //
  // La guardia non guarda le righe: una chiamata `t(` su piu' righe
  // (`t('pay', {\n  amount: ... })`) sfuggirebbe a un filtro per riga, e la
  // forma `formatEuroCents(` non contiene la sottostringa `formatEuro(`. Si
  // scansiona il sorgente intero, si prende ogni `t(`/`tFreeShippingBadge(` e
  // si legge l'argomento fino alla parentesi che lo chiude.
  const source = fs.readFileSync(CHECKOUT_SOURCE, 'utf8')
  const doubleSymbol: string[] = []
  for (const call of source.matchAll(/\b(?:t|tFreeShippingBadge)\s*\(/g)) {
    const start = call.index! + call[0].length
    let depth = 1
    let end = start
    for (; end < source.length && depth > 0; end += 1) {
      const char = source[end]
      if (char === '(') depth += 1
      else if (char === ')') depth -= 1
    }
    const argument = source.slice(start, end - 1)
    if (/format(?:Euro|EuroCents)\s*\(/.test(argument)) {
      doubleSymbol.push(argument.replace(/\s+/g, ' ').slice(0, 120))
    }
  }
  assert.deepEqual(
    doubleSymbol,
    [],
    'formatEuro/formatEuroCents dentro una chiamata t(): la frase ha gia\' il simbolo, usare formatMoneyCents',
  )
})

test('ogni frase di soldi ha il simbolo una volta sola', () => {
  // `{amount}€` = un simbolo. Due significherebbero `106,65€€` in pagina;
  // zero, un importo senza valuta. Vale anche dopo che la frase diventa
  // `<b>{amount}€</b>` (PR #62).
  for (const locale of MONEY_LOCALES) {
    const flat = flatten(readMessages(locale))
    for (const key of ['freeShippingAdd', 'labelFreeAbove', 'pay']) {
      const value = flat[`checkout.${key}`] ?? ''
      const count = (value.match(/€/g) ?? []).length
      assert.equal(count, 1, `${locale}.checkout.${key}: ${count} simboli € in «${value}»`)
    }
  }
})
