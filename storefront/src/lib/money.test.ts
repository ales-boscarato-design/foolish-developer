import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { test } from 'node:test'

import {
  EURO_SIGN,
  MONEY_LOCALES,
  MONEY_LOCALE_TAGS,
  PERCENT_SIGN,
  eurosToDisplayCents,
  formatEuro,
  formatEuroCents,
  formatMachineMoneyCents,
  formatMoney,
  formatMoneyCents,
  formatPercentBps,
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
import { getEmailCopy } from '../emails/copy'

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
  assert.equal(formatMoney('fr', 106.65), '106,65')
  assert.equal(formatMoney('en', 106.65), '106.65')
  assert.equal(formatMoney('de', 37.65), '37,65')
  assert.equal(formatMoneyCents('en', 1_066_500), '10,665.00')
  assert.equal(formatMoneyCents('fr', 1_066_500), '10\u202f665,00')

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

test('ProductCard e ProductDetail conservano la posizione originale del simbolo euro', () => {
  const productCard = fs.readFileSync(path.join(process.cwd(), 'src/components/ProductCard.tsx'), 'utf8')
  const productDetail = fs.readFileSync(path.join(process.cwd(), 'src/components/ProductDetail.tsx'), 'utf8')

  assert.match(productCard, /`Da €\$\{formatMoney\(locale, lowestPrice\)\}`/)
  assert.match(productCard, /`€\$\{formatMoney\(locale, lowestPrice\)\}`/)
  assert.match(productDetail, /\$\{formatMoney\(locale, firstVariant\.price\)\}€/)
  assert.match(productDetail, /\$\{formatMoney\(locale, component\.basePrice\)\}€/)
  assert.match(productDetail, /\{formatMoney\(locale, selectedVariant\.price\)\}€/)
  // L'etichetta del risparmio e' una chiave i18n (`packs.save`), il simbolo
  // resta dopo il testo e prima del numero: si pinna la riga che emette il
  // valore, con l'indentazione vera, perche' un pin a sottostringa resta verde
  // anche su una riga di commento.
  assert.match(
    productDetail,
    /^ {28}\{t\('packs\.save'\)\} €\{formatMoney\(locale, \(selectedVariant\.price \* pack\.quantity\) \* \(pack\.discountPercent \/ 100\)\)\}$/m,
  )
  assert.match(productDetail, /€\{formatMoney\(locale, selectedVariant\.price \* pack\.quantity\)\}/)
  assert.match(productDetail, /€\{formatMoney\(locale, selectedVariant\.price \* pack\.quantity \* \(1 - pack\.discountPercent \/ 100\)\)\}/)

  assert.equal(`Da €${formatMoney('it', 106.65)}`, 'Da €106,65')
  assert.equal(`€${formatMoney('en', 106.65)}`, '€106.65')
  assert.equal(`${formatMoney('it', 106.65)}€`, '106,65€')
})

test('ringraziamento e email carrello usano il formatter con la lingua effettiva', () => {
  const thankYou = fs.readFileSync(path.join(process.cwd(), 'src/app/[locale]/grazie/page.tsx'), 'utf8')
  const abandonedCart = fs.readFileSync(path.join(process.cwd(), 'src/emails/abandoned-cart.tsx'), 'utf8')
  assert.match(thankYou, /formatEuro\(locale, total\)/)
  assert.match(thankYou, /formatEuro\(locale, item\.unitAmount \* item\.quantity\)/)
  assert.match(abandonedCart, /€\{formatMoney\(locale, item\.price \* item\.quantity\)\}/)
  assert.doesNotMatch(thankYou, /\.toFixed\s*\(/)
  assert.doesNotMatch(abandonedCart, /\.toFixed\s*\(/)
  assert.equal(formatEuro('it', 106.65), '106,65€')
  assert.equal(formatEuro('en', 106.65), '106.65€')
  for (const locale of MONEY_LOCALES) {
    assert.equal(typeof getEmailCopy(locale).abandoned_cart.subject, 'string')
  }
})

test('i call-site monetari preservano posizione e spazio del simbolo rispetto a origin/main', () => {
  const sites: Record<string, string[]> = {
    'src/components/SubscriptionRoadmap.tsx': [
      '€{formatMoney(locale, phase.productPrice + phase.shippingPrice)} {labels.perMonth}',
    ],
    'src/app/(customer-app)/account/(protected)/abbonamento/page.tsx': [
      "{t('subscription_cycle')} {currentCycle} · {t('subscription_current_price')} €{formatMoney(locale, benefit.total)}",
    ],
    'src/app/(customer-app)/account/(protected)/file/page.tsx': [
      '<div style={{ fontSize: \'10px\', color: \'#555\' }}>€{formatMoney(locale, item.product_price)}</div>',
    ],
    'src/app/(customer-app)/account/(protected)/offerta/page.tsx': [
      '€{formatMoney(locale, product.basePrice * (1 - offer.discount_percent / 100))}',
      '€{formatMoney(locale, product.basePrice)}',
    ],
    'src/app/(customer-app)/account/(protected)/ordini/page.tsx': [
      "{lineItems.map(i => i.name).join(', ')} · €{order.total == null ? '' : formatMoney(locale, order.total as number)}\n",
    ],
    'src/emails/abandoned-cart.tsx': [
      '€{formatMoney(locale, item.price * item.quantity)}</span>',
    ],
    'src/app/[locale]/grazie/page.tsx': [
      '{formatEuro(locale, total)}',
      '{formatEuro(locale, item.unitAmount * item.quantity)}',
    ],
  }
  const sourceByPath = new Map<string, string>()
  for (const [sourcePath, expected] of Object.entries(sites)) {
    const source = fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8')
    sourceByPath.set(sourcePath, source)
    for (const snippet of expected) {
      assert.ok(source.includes(snippet), `${sourcePath} deve contenere il call-site: ${snippet}`)
    }
  }

  const examples = [
    `€${formatMoney('it', 106.65)}`,
    `€${formatMoney('en', 106.65)}`,
    ` €${formatMoney('it', 106.65)}`,
    ` €${formatMoney('en', 106.65)}`,
    `${formatMoney('it', 106.65)}€`,
    `${formatMoney('en', 106.65)}€`,
  ]
  assert.deepEqual(examples, ['€106,65', '€106.65', ' €106,65', ' €106.65', '106,65€', '106.65€'])

  // Prova di mutazione: ciascun sito richiesto viene cambiato da prefisso a
  // suffisso; il controllo del call-site deve diventare rosso per tutti.
  for (const sourcePath of Object.keys(sites)) {
    const source = sourceByPath.get(sourcePath)!
    const target = sites[sourcePath][0]
    if (!target.includes('€')) continue // grazie mantiene intenzionalmente il suffisso.
    const mutated = source.replace(target, target.replace('€', ''))
    assert.notEqual(mutated, source, `${sourcePath}: la mutazione deve modificare il sorgente`)
    assert.throws(() => {
      for (const expected of sites[sourcePath]) {
        assert.ok(mutated.includes(expected), `${sourcePath} mutato non conserva ${expected}`)
      }
    }, `${sourcePath}: il controllo deve rifiutare il cambio a suffisso`)
  }
})

test('gli ordini mantengono il prefisso euro anche senza totale e formattano importi per lingua', () => {
  const ordersPage = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(customer-app)/account/(protected)/ordini/page.tsx'),
    'utf8',
  )
  assert.ok(
    ordersPage.includes("· €{order.total == null ? '' : formatMoney(locale, order.total as number)}"),
    'il simbolo euro resta fuori dalla condizione sul totale',
  )

  const renderTotal = (locale: string, total: number | null | undefined) =>
    `€${total == null ? '' : formatMoney(locale, total)}`

  assert.equal(renderTotal('fr', null), '€')
  assert.equal(renderTotal('fr', undefined), '€')
  assert.equal(renderTotal('fr', 0), '€0,00')
  assert.equal(renderTotal('fr', 106.65), '€106,65')
  assert.equal(renderTotal('en', null), '€')
  assert.equal(renderTotal('en', undefined), '€')
  assert.equal(renderTotal('en', 0), '€0.00')
  assert.equal(renderTotal('en', 106.65), '€106.65')
})

test('i consumatori UI monetari usano money.ts e il locale effettivo', () => {
  const sources = [
    'src/components/ProductCard.tsx',
    'src/components/ProductDetail.tsx',
    'src/components/SubscriptionRoadmap.tsx',
    'src/app/(customer-app)/account/(protected)/file/page.tsx',
    'src/app/(customer-app)/account/(protected)/offerta/page.tsx',
    'src/app/(customer-app)/account/(protected)/ordini/page.tsx',
    'src/app/(customer-app)/account/(protected)/abbonamento/page.tsx',
    'src/lib/subscription-renewal-zone-alert.ts',
  ]
  for (const sourcePath of sources) {
    const source = fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8')
    assert.match(source, /from ['"].*\/money['"]/, `${sourcePath} deve usare money.ts`)
  }
  for (const sourcePath of sources.slice(0, 7)) {
    const source = fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8')
    assert.match(source, /format(?:Euro|Money)\(locale,/, `${sourcePath} deve formattare nel locale effettivo`)
  }
})

test('subscription-renewal-zone-alert vieta toFixed anche con accesso statico tra parentesi', () => {
  const sourcePath = 'src/lib/subscription-renewal-zone-alert.ts'
  const source = fs.readFileSync(path.join(process.cwd(), sourcePath), 'utf8')
  const legacyFormatter = /(?:\?\.\s*(?:toFixed\b|\[\s*(['"])toFixed\1\s*\])|\.\s*toFixed\b|\[\s*(['"])toFixed\2\s*\])\s*(?:\?\.)?\s*\(/m
  const assertNoLegacyFormatter = (candidate: string) =>
    assert.doesNotMatch(candidate, legacyFormatter, `${sourcePath} non deve formattare denaro con toFixed`)

  assertNoLegacyFormatter(source)

  // Riproduce sul sorgente reale il bypass della review: il controllo deve
  // intercettare l'accesso statico tra parentesi che mostrava 106.65 in FR.
  const mutationTarget = "formatMoney('it', value)"
  assert.equal((106.65).toFixed(2), '106.65', 'la mutazione riproduce il separatore errato in francese')
  for (const replacement of [
    "value.toFixed(2)",
    "value['toFixed'](2)",
    'value["toFixed"](2)',
    "value?.['toFixed'](2)",
    'value?.["toFixed"]?.(2)',
  ]) {
    const mutated = source.replace(mutationTarget, replacement)
    assert.notEqual(mutated, source, `la mutazione deve colpire il formatter reale: ${replacement}`)
    assert.throws(
      () => assertNoLegacyFormatter(mutated),
      /non deve formattare denaro con toFixed/,
      `la guardia deve rifiutare ${replacement}`,
    )
  }
})

test('importi di confine: zero, mezzo euro, valori gia arrotondati, negativo', () => {
  for (const cents of [-123_456, -1, 0, 1, 50, 999_999, 100_000_001]) {
    assert.equal(formatMachineMoneyCents(cents), (cents / 100).toFixed(2))
  }

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
  // Un intero che non e' rappresentabile esattamente (2**53) non e' un
  // importo: si ferma con il messaggio di questa funzione, non con quello della
  // conversione a centesimi (che direbbe «centesimi non interi» e non si capisce
  // da dove arrivi).
  assert.throws(() => formatWholeMoney('it', 2 ** 53), /formatWholeMoney: importo non intero/)
})

// ------------------------------------------------------------ percentuali

test('un aliquota in punti base si legge nella lingua, due decimali solo se servono', () => {
  // Le aliquote del programma affiliati sono intere in punti base: 500 = 5%,
  // 1250 = 12,5%, 333 = 3,33%. Il segno sta fuori dal numero e attaccato, come
  // l'euro: `style: 'percent'` lo metterebbe dentro con lo spazio del locale.
  assert.equal(PERCENT_SIGN, '%')
  for (const locale of MONEY_LOCALES) {
    assert.equal(formatPercentBps(locale, 500), '5%', `${locale}: cinque per cento`)
    assert.equal(formatPercentBps(locale, 0), '0%', `${locale}: zero`)
    assert.equal(formatPercentBps(locale, 2000), '20%', `${locale}: venti per cento`)
  }
  assert.equal(formatPercentBps('it', 1250), '12,5%')
  assert.equal(formatPercentBps('en', 1250), '12.5%')
  assert.equal(formatPercentBps('fr', 1250), '12,5%')
  assert.equal(formatPercentBps('de', 1250), '12,5%')
  assert.equal(formatPercentBps('es', 1250), '12,5%')
  assert.equal(formatPercentBps('it', 333), '3,33%')
  assert.equal(formatPercentBps('en', 333), '3.33%')
  // Sopra il migliaio si raggruppa nella lingua (non `1,234.5` in italiano).
  assert.equal(formatPercentBps('it', 123450), '1.234,5%')
  assert.equal(formatPercentBps('en', 123450), '1,234.5%')
  // Una lingua non pubblicata ricade sul default di routing, mai su `undefined`.
  assert.equal(formatPercentBps('xx', 500), '5%')
  assert.equal(formatPercentBps(undefined, 500), '5%')
})

test('i punti base non si arrotondano: la cifra scritta e quella contata', () => {
  // Il rischio di `Intl` su un decimale gia' scritto: 1250/100 e' 12,5 ma in
  // binario non e' esatto, e un formattatore con `maximumFractionDigits: 2`
  // potrebbe mostrare `12,49%` su un valore che il registro conta come 12,5.
  // Si controlla la cifra, non solo la forma: ogni punto base intero, da 0 a
  // 20000, si rilegge come se stesso dopo la formattazione.
  for (let bps = 0; bps <= 20000; bps += 1) {
    const written = formatPercentBps('en', bps).replace(PERCENT_SIGN, '')
    const reread = Math.round(Number(written.replace(/,/g, '')) * 100)
    assert.equal(reread, bps, `${bps} punti base scritti come ${written}`)
  }
  // Un punto base frazionario e' un errore di programmazione, non un'aliquota.
  assert.throws(() => formatPercentBps('it', 12.5), /punti base non interi/)
  assert.throws(() => formatPercentBps('it', Number.NaN), /punti base non interi/)
  assert.throws(() => formatPercentBps('it', '500' as unknown as number), /punti base non interi/)
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
    3,
    'i tre formattatori (2 decimali, importo tondo, percentuale) devono costruirsi dal tag esplicito',
  )
  // Nessuna terza strada: il file costruisce esattamente tre formattatori, e
  // ogni menzione di `Intl.NumberFormat(` e' una di quelle tre costruzioni
  // (quindi nessuna chiamata senza `new`, ammessa da ES2020). Il sorgente e'
  // letto GREZZO, commenti compresi: un filtro che scarta righe puo' nascondere
  // codice vero (una riga `*` e' un metodo generatore valido).
  const constructed = source.match(/new Intl\.NumberFormat\(/g) ?? []
  const mentioned = source.match(/Intl\.NumberFormat\(/g) ?? []
  assert.equal(
    constructed.length,
    3,
    'money.ts non deve costruire altri formattatori oltre ai tre (2 decimali, importo tondo, percentuale)',
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
  // I percorsi USATI, non solo le costruzioni. Una sostituzione di corpo
  // — `(cents / 100).toLocaleString(normalizeMoneyLocale(locale), …)` — lascia
  // le costruzioni al loro posto (e `wholeFormatterFor` inutilizzato) con la
  // suite verde, perche' lingua nuda e tag esplicito rendono uguale su un
  // importo tondo: misurato da una review indipendente. Quindi si pinna il
  // ritorno di ogni funzione e si vieta la terza strada.
  assert.ok(
    /return formatterFor\(normalizeMoneyLocale\(locale\)\)\.format\(/.test(source),
    'formatMoneyCents deve formattare con formatterFor sulla lingua normalizzata',
  )
  assert.ok(
    /return wholeFormatterFor\(normalizeMoneyLocale\(locale\)\)\.format\(/.test(source),
    'formatWholeMoney deve formattare con wholeFormatterFor sulla lingua normalizzata',
  )
  assert.ok(
    /return `\$\{percentFormatterFor\(normalizeMoneyLocale\(locale\)\)\.format\(bps \/ 100\)\}\$\{PERCENT_SIGN\}`/.test(source),
    'formatPercentBps deve formattare con percentFormatterFor e comporre il segno, non riscriverlo',
  )
  assert.ok(
    !/toLocaleString/.test(source),
    'money.ts non deve formattare con `toLocaleString`: i formattatori cache-ati sul tag esplicito sono la sola strada',
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

// Eccezioni puntuali: ogni espressione autorizzata e' censita per riga di
// codice (senza numero di riga). Il solo conteggio consentiva di sostituire
// l'uso non monetario con toString e aggiungere un toFixed monetario altrove.
// Motivi: file/page = dimensione in MB; JSON-LD = valori numerici schema.org;
// promo/validate = amount numerico API; webhook/stripe e stripe-orders =
// serializzazione/calcolo; ProductDetail/ReviewList = rating; money.ts =
// conservare l'arrotondamento preesistente e serializzare importi machine-only;
// shipping.ts = arrotondamento anti-sottostima;
// shipping.test.ts = asserzione numerica, non display.
const TO_FIXED_ALLOWLIST: Record<string, string[]> = {
  'src/app/(customer-app)/account/(protected)/file/page.tsx': [
    'const sizeMb = file.file?.filesize ? (file.file.filesize / 1024 / 1024).toFixed(1) : null',
  ],
  'src/app/[locale]/prodotto/[slug]/page.tsx': [
    "price: lowestPrice.toFixed(2),",
    'ratingValue: reviewSummary.average.toFixed(1),',
  ],
  'src/app/api/promo/validate/route.ts': [
    '...(promo.discountAmountCents > 0 ? { discountAmount: Number((promo.discountAmountCents / 100).toFixed(2)) } : {}),',
    'discountAmount: Number((discountAmountCents / 100).toFixed(2)),',
    '...(promo.discountAmountCents > 0 ? { discountAmount: Number((promo.discountAmountCents / 100).toFixed(2)) } : {}),',
  ],
  'src/app/api/webhook/stripe/route.ts': [
    'const total = ((session.amount_total ?? 0) / 100).toFixed(2)',
  ],
  'src/components/ProductDetail.tsx': [
    '{reviewSummary.average.toFixed(1)} ({reviewSummary.count})',
  ],
  'src/components/ReviewList.tsx': [
    "{summary.average.toFixed(1)} · {summary.count} {locale === 'it' ? 'recensioni' : 'reviews'}",
  ],

  'src/lib/money.ts': [
    '  const cents = Math.round(Number(amount.toFixed(2)) * 100)',
    '  return (cents / 100).toFixed(2)',
  ],
  'src/lib/shipping.test.ts': [
    "  assert.equal(blend.toFixed(4), '0.0442')",
  ],
  'src/lib/shipping.ts': [
    '  return Math.ceil(Number((value * 100).toFixed(6))) / 100',
  ],
  'src/lib/stripe-orders.ts': [
    '  const shippingCost = Math.max(0, Number((total - itemsTotal).toFixed(2)))',
  ],
}

function findToFixedLines(files: Record<string, string>): Record<string, string[]> {
  function unwrapParentheses(expression: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression
    return expression
  }

  function isStaticToFixedAccess(expression: ts.Expression): expression is ts.PropertyAccessExpression | ts.ElementAccessExpression {
    expression = unwrapParentheses(expression)

    if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 'toFixed'
    if (!ts.isElementAccessExpression(expression)) return false

    const argument = expression.argumentExpression
    return Boolean(
      argument &&
      ((ts.isStringLiteral(argument) && argument.text === 'toFixed') ||
        (ts.isNoSubstitutionTemplateLiteral(argument) && argument.text === 'toFixed')),
    )
  }

  function isToFixedInvocation(expression: ts.Expression): ts.Expression | null {
    expression = unwrapParentheses(expression)
    if (isStaticToFixedAccess(expression)) return expression

    // Number.prototype.toFixed.call/apply(amount, ...) bypasses a check that
    // only looks for a CallExpression whose immediate callee is toFixed.
    if (ts.isPropertyAccessExpression(expression) && (expression.name.text === 'call' || expression.name.text === 'apply')) {
      const target = unwrapParentheses(expression.expression)
      if (isStaticToFixedAccess(target)) return target
    }
    return null
  }

  function collectToFixedCalls(file: string, source: string): string[] {
    const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind)
    const parseErrors = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
    assert.deepEqual(
      parseErrors,
      [],
      `${file}: sorgente non parsabile, guardia toFixed fail-closed`,
    )

    const lines: string[] = []
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const access = isToFixedInvocation(node.expression)
        if (access) {
          const accessName = ts.isPropertyAccessExpression(access)
            ? access.name
            : ts.isElementAccessExpression(access)
              ? access.argumentExpression
              : undefined
          const accessStart = accessName?.getStart(sourceFile)
          if (accessStart !== undefined) {
            const line = sourceFile.getLineAndCharacterOfPosition(accessStart).line
            lines.push(source.split('\n')[line]?.trim() ?? '')
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return lines
  }

  return Object.fromEntries(
    Object.entries(files)
      .filter(([file]) => file !== 'src/lib/money.test.ts')
      .map(([file, source]) => [file, collectToFixedCalls(file, source)] as const)
      .filter(([, lines]) => lines.length > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

function readSourceTree(directory: string, prefix = 'src'): Record<string, string> {
  const result: Record<string, string> = {}
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    const relative = `${prefix}/${entry.name}`
    if (entry.isDirectory()) Object.assign(result, readSourceTree(absolute, relative))
    else if (/\.tsx?$/.test(entry.name)) result[relative] = fs.readFileSync(absolute, 'utf8')
  }
  return result
}

test('whitelist completa e fail-closed per gli usi residui di toFixed', () => {
  const actual = findToFixedLines(readSourceTree(path.join(process.cwd(), 'src')))
  const expected = Object.fromEntries(
    Object.entries(TO_FIXED_ALLOWLIST)
      .map(([file, lines]) => [file, lines.map((line) => line.trim())] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  )
  assert.deepEqual(actual, expected)


  // Riproduzione avversaria: conserva intatto il rating consentito e aggiunge
  // un formatter monetario con optional chaining nella pagina reale. La
  // allowlist deve rifiutare il nuovo call-site, non solo contare le chiamate.
  const productDetail = fs.readFileSync(path.join(process.cwd(), 'src/components/ProductDetail.tsx'), 'utf8')
  const parenthesizedCallSite = productDetail.replace(
    '{formatMoney(locale, selectedVariant.price)}€',
    "{(selectedVariant.price['toFixed'])(2)}€",
  )
  assert.notEqual(parenthesizedCallSite, productDetail, 'la mutazione deve sostituire il vero call-site ProductDetail')

  // La vecchia guardia guardava direttamente CallExpression.expression: qui
  // trova un ParenthesizedExpression e quindi non vedeva il metodo statico.
  const mutatedProductDetailAst = ts.createSourceFile(
    'src/components/ProductDetail.tsx',
    parenthesizedCallSite,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  let legacyGuardMissedParenthesizedCall = false
  function findLegacyMiss(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isParenthesizedExpression(node.expression)) {
      const inner = node.expression.expression
      if (ts.isElementAccessExpression(inner) && inner.argumentExpression?.getText(mutatedProductDetailAst) === "'toFixed'") {
        legacyGuardMissedParenthesizedCall = true
      }
    }
    ts.forEachChild(node, findLegacyMiss)
  }
  findLegacyMiss(mutatedProductDetailAst)
  assert.ok(legacyGuardMissedParenthesizedCall, 'la mutazione riproduce il bypass della vecchia guardia AST')

  const parenthesizedFindings = findToFixedLines({
    'src/components/ProductDetail.tsx': parenthesizedCallSite,
  })
  assert.deepEqual(
    parenthesizedFindings,
    { 'src/components/ProductDetail.tsx': [
      ...TO_FIXED_ALLOWLIST['src/components/ProductDetail.tsx'],
      "{(selectedVariant.price['toFixed'])(2)}€",
    ] },
    'la nuova guardia AST rileva il formatter monetario parenthesized nel vero call-site senza perdere il rating consentito',
  )

  // La review ha riprodotto il bypass via Number.prototype.toFixed.call.
  // Mutiamo il call-site monetario reale: la vecchia guardia (solo callee
  // diretto) non vede il toFixed annidato sotto .call/.apply, la nuova sì.
  for (const [replacement, label] of [
    ['{Number.prototype.toFixed.call(selectedVariant.price, 2)}€', 'call'],
    ['{Number.prototype.toFixed.apply(selectedVariant.price, [2])}€', 'apply'],
  ]) {
    const callApplyMutation = productDetail.replace(
      '{formatMoney(locale, selectedVariant.price)}€',
      replacement,
    )
    assert.notEqual(callApplyMutation, productDetail, `la mutazione ${label} deve colpire il call-site ProductDetail reale`)

    const mutatedAst = ts.createSourceFile(
      'src/components/ProductDetail.tsx',
      callApplyMutation,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    )
    let legacyGuardMissedBypass = false
    function findLegacyBypass(node: ts.Node): void {
      if (ts.isCallExpression(node)) {
        const callee = node.expression
        // The old recognizer only accepted direct `.toFixed(...)` calls.
        if (
          ts.isPropertyAccessExpression(callee) &&
          callee.name.text === 'toFixed' &&
          node.getText(mutatedAst).includes('selectedVariant.price')
        ) {
          legacyGuardMissedBypass = true
        }
      }
      ts.forEachChild(node, findLegacyBypass)
    }
    findLegacyBypass(mutatedAst)
    assert.equal(legacyGuardMissedBypass, false, `la vecchia guardia diretta deve riprodursi bypassata con ${label}`)

    assert.deepEqual(
      findToFixedLines({ 'src/components/ProductDetail.tsx': callApplyMutation }),
      {
        'src/components/ProductDetail.tsx': [
          ...TO_FIXED_ALLOWLIST['src/components/ProductDetail.tsx'],
          replacement,
        ],
      },
      `la nuova guardia AST rileva Number.prototype.toFixed.${label} sul call-site reale`,
    )
  }
  assert.equal(Number.prototype.toFixed.call(106.65, 2), '106.65', 'la mutazione riproduce il separatore errato in FR')
  assert.equal(Number.prototype.toFixed.apply(106.65, [2]), '106.65', 'anche apply bypassa il formatter localizzato')

  const attacked = productDetail.replace(
    '{formatMoney(locale, selectedVariant.price)}€',
    '{selectedVariant.price.toFixed?.(2)}€',
  )
  assert.notEqual(attacked, productDetail, 'la mutazione avversaria deve modificare il sorgente')
  assert.match(attacked, /reviewSummary\.average\.toFixed\(1\)/, 'la chiamata consentita deve restare nel campione mutato')
  assert.match(attacked, /selectedVariant\.price\.toFixed\?\.\(2\)/, 'la mutazione deve usare la forma optional-chain riprodotta')
  assert.throws(
    () => assert.deepEqual(
      findToFixedLines({ 'src/components/ProductDetail.tsx': attacked }),
      { 'src/components/ProductDetail.tsx': TO_FIXED_ALLOWLIST['src/components/ProductDetail.tsx'] },
    ),
    'la guardia deve rilevare il toFixed monetario inserito in ProductDetail',
  )

  // La guardia globale deve rilevare anche l'accesso statico bracket nel vero
  // call-site del checkout, incluse le varianti con apici singoli o doppi.
  const checkoutPath = 'src/app/[locale]/checkout/page.tsx'
  const checkout = fs.readFileSync(path.join(process.cwd(), checkoutPath), 'utf8')
  const checkoutMutation = checkout.replace(
    '{formatEuro(locale, item.price * item.quantity)}',
    "{(item.price * item.quantity)['toFixed'](2)}",
  )
  assert.notEqual(checkoutMutation, checkout, 'la mutazione bracket deve modificare il vero checkout')
  assert.throws(
    () => assert.deepEqual(findToFixedLines({ [checkoutPath]: checkoutMutation }), {}),
    'la guardia globale deve rilevare toFixed con accesso bracket nel checkout',
  )
  const oldHeuristicMissesUrlBeforeCall = (source: string) => {
    const index = source.indexOf('.toFixed(2)') + 1
    let cursor = index
    while (cursor > 0 && /\s/.test(source[cursor - 1])) cursor -= 1
    const lineStart = source.lastIndexOf('\n', cursor - 1) + 1
    const lineComment = source.lastIndexOf('//', cursor - 1)
    if (lineComment >= lineStart) cursor = lineComment
    const oldHeuristicAccess = source.slice(Math.max(0, index - 256), cursor)
    return !/(?:\.|\?\.)$/.test(oldHeuristicAccess)
  }
  const checkoutCallSite = checkout.replace(
    '{formatEuro(locale, item.price * item.quantity)}',
    "{(() => { const checkoutUrl = 'https://shop.example/checkout//amount'; return (item.price * item.quantity).toFixed(2) })()}",
  )
  assert.notEqual(checkoutCallSite, checkout, 'la mutazione deve sostituire il vero importo del checkout')
  assert.ok(oldHeuristicMissesUrlBeforeCall(checkoutCallSite), 'la guardia precedente deve fallire sul // dentro l’URL prima del call-site monetario')
  assert.notDeepEqual(
    findToFixedLines({ [checkoutPath]: checkoutCallSite }),
    {},
    'la guardia AST rileva il toFixed monetario nel vero call-site checkout anche dopo una URL contenente //',
  )

  const commentDecoys = [
    "// amount.toFixed(2) is forbidden only as code, not in this comment",
    '/* amount["toFixed"](2) is documentation, not an invocation */',
    "const message = 'amount.toFixed(2) is text';",
  ].join('\n')
  assert.deepEqual(findToFixedLines({ 'src/comment-decoys.ts': commentDecoys }), {})

  assert.deepEqual(
    findToFixedLines({
      'src/attacker.ts': `amount['toFixed'](2); amount["toFixed"]?.(2); amount?.['toFixed'](2); amount?.["toFixed"]?.(2)`,
    }),
    {
      'src/attacker.ts': [
        `amount['toFixed'](2); amount["toFixed"]?.(2); amount?.['toFixed'](2); amount?.["toFixed"]?.(2)`,
        `amount['toFixed'](2); amount["toFixed"]?.(2); amount?.['toFixed'](2); amount?.["toFixed"]?.(2)`,
        `amount['toFixed'](2); amount["toFixed"]?.(2); amount?.['toFixed'](2); amount?.["toFixed"]?.(2)`,
        `amount['toFixed'](2); amount["toFixed"]?.(2); amount?.['toFixed'](2); amount?.["toFixed"]?.(2)`,
      ],
    },
  )
  for (const expression of [
    "amount['toFixed']\n(2)",
    "amount['toFixed'] /* comment */ (2)",
    'amount["toFixed"] // comment\n(2)',
  ]) {
    assert.deepEqual(
      findToFixedLines({ 'src/attacker.ts': expression }),
      { 'src/attacker.ts': [expression.split('\n')[0].trim()] },
      `la guardia globale deve rilevare accesso bracket separato da newline/commento: ${expression}`,
    )
  }

  const allowedCallWithComment = productDetail.replace(
    '{reviewSummary.average.toFixed(1)} ({reviewSummary.count})',
    '{reviewSummary.average.toFixed(1)} ({reviewSummary.count}) {/* toFixed consentito */}',
  )
  assert.notEqual(allowedCallWithComment, productDetail, 'la mutazione con commento deve modificare il sorgente')
  assert.throws(
    () => assert.deepEqual(
      findToFixedLines({ 'src/components/ProductDetail.tsx': allowedCallWithComment }),
      { 'src/components/ProductDetail.tsx': TO_FIXED_ALLOWLIST['src/components/ProductDetail.tsx'] },
    ),
    'la whitelist deve richiedere la riga esatta e rifiutare commenti/testo aggiunti',
  )

  // Un nuovo file non censito deve fallire in modo chiuso.
  assert.throws(
    () => assert.deepEqual(
      findToFixedLines({ 'src/nuovo-componente.tsx': 'const price = amount.toFixed(2)' }),
      {},
    ),
  )
  assert.deepEqual(
    findToFixedLines({ 'src/static-template.ts': 'amount[`toFixed`](2)' }),
    { 'src/static-template.ts': ['amount[`toFixed`](2)'] },
    'l’accesso statico con template literal senza interpolazione va rilevato',
  )
})
