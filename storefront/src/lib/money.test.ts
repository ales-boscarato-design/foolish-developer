import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  EURO_SIGN,
  MONEY_LOCALES,
  formatEuro,
  formatMoney,
  normalizeMoneyLocale,
} from './money'
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

  // 3. `formatEuro` mai passato a una frase che ha gia' il suo `€`: il
  // messaggio e' `... {amount}€`, quindi li' va `formatMoney`, altrimenti il
  // cliente legge `106,65€€`. E' esattamente l'incidente che il merge con
  // #62 puo' produrre, e nessun altro test lo vedrebbe.
  const doubleSymbol = lines
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /\bt\s*\(/.test(line) && line.includes('formatEuro('))
  assert.deepEqual(
    doubleSymbol.map((l) => `${l.number}: ${l.line.trim()}`),
    [],
    'formatEuro dentro una chiamata t(): la frase ha gia\' il simbolo, usare formatMoney',
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
