import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  EURO_SIGN,
  MONEY_LOCALES,
  formatEuro,
  formatEuroCents,
  formatMoney,
  normalizeMoneyLocale,
} from './money'

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
  // dava `toFixed(2)`. Vale per i valori che il catalogo produce — prezzi a due
  // decimali moltiplicati per quantita' intere — dove l'arrotondamento dei
  // centesimi e quello del decimale coincidono per costruzione.
  const corpus = [
    0, 0.5, 1, 7.65, 14.99, 30, 37.65, 99, 106.65, 999.99, 1234.5,
    8.125 * 50, 0.1 + 0.2, 30.000000000000004, 0.07 * 3,
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
})

test('sui valori a mezzo centesimo mostra i centesimi che il checkout incassa', () => {
  // `toFixed(2)` arrotonda il decimale, il checkout incassa
  // `Math.round(price * quantity * 100)`: sui mezzi centesimi le due strade
  // divergono di un centesimo, e il numero che deve stare in pagina e' quello
  // dei centesimi. Sono valori che il catalogo a due decimali non produce
  // (restano irraggiungibili oggi): il test pinna la regola, non un caso vivo.
  const halfCent = [1.005, 2.675, 1.335, 0.105, 2.625]
  for (const amount of halfCent) {
    const chargedCents = Math.round(amount * 100)
    const expectedDigits = (chargedCents / 100).toFixed(2).replace(/\D/g, '')
    for (const locale of MONEY_LOCALES) {
      const actualDigits = formatMoney(locale, amount).replace(/\D/g, '')
      assert.equal(
        actualDigits,
        expectedDigits,
        `${locale} ${amount}: mostra ${formatMoney(locale, amount)}, il checkout incassa ${chargedCents} centesimi`,
      )
    }
  }
  // La divergenza dal vecchio `toFixed` esiste ed e' quella attesa: se un
  // giorno sparisse, questo test lo dice invece di lasciar credere che le due
  // regole siano la stessa.
  assert.notEqual(formatMoney('it', 2.675).replace(/\D/g, ''), (2.675).toFixed(2).replace(/\D/g, ''))
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

test('dai centesimi, dove il valore nasce in centesimi', () => {
  assert.equal(formatEuroCents('it', 3000), '30,00€')
  assert.equal(formatEuroCents('en', 10665), '106.65€')
  assert.equal(formatEuroCents('it', 0), '0,00€')
  // Un valore non intero in centesimi e' un errore di chiamata, non un prezzo.
  assert.throws(() => formatEuroCents('it', 30.5), TypeError)
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

// --------------------------------------------------- messaggi: nessun importo

/**
 * Due chiavi della pagina Pro scrivono ancora la soglia a mano («20% da 400€»).
 * NON sono il checkout e non si correggono qui: sono elencate per nome, cosi'
 * un importo scritto a mano che comparisse ALTROVE fa fallire il test, e
 * quando la pagina Pro verra' sistemata queste due righe si tolgono.
 */
const KNOWN_HAND_WRITTEN_AMOUNTS = new Set([
  'pro.benefit1.title',
  'pro.card.benefit2',
])

/** Un importo in chiaro: cifre attaccate al simbolo, in testa o in coda. */
const HAND_WRITTEN_AMOUNT = /(?:\d[\d.,]*\s*€)|(?:€\s*\d)/

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
  // Ogni riga che rende euro deve passare dall'helper, non da una stringa
  // costruita a mano: il simbolo in pagina lo aggiunge `formatEuro`.
  const manualEuro = source
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /€\$\{/.test(line) || /`?€\{/.test(line))
  assert.deepEqual(
    manualEuro,
    [],
    `euro composti a mano nel checkout: ${manualEuro.map((l) => `riga ${l.number}: ${l.line.trim()}`).join(' | ')}`,
  )
})
