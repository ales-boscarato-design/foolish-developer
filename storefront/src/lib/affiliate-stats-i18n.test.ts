import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createTranslator } from 'next-intl'

import { MONEY_LOCALES, MONEY_LOCALE_TAGS, formatEuroCents, formatPercentBps } from './money'
import { formatLongDate } from './date-format'

/**
 * The affiliate statistics page is the one page of the shop read by people who
 * are not customers and not Italian speakers. A key added in one message file
 * and forgotten in another would not fail the build: the page would simply show
 * the raw key, or throw at render time, in one language only. This pins the
 * parity of the namespace across every published locale.
 *
 * Il secondo difetto che questo file chiude (12/11/2026): la pagina costruiva i
 * propri formattatori con il locale di ROUTING (`it`, `en`, …) invece dei tag
 * espliciti di `money.ts` (`it-IT`, `en-GB`, …), e con `style: 'currency'`
 * metteva il simbolo euro DENTRO il valore, con lo spazio deciso dal locale.
 * Il resto del negozio scrive `1.234,56€`: simbolo fuori, attaccato. Qui si
 * pinna la resa nelle cinque lingue, il simbolo una volta sola, e il fatto che
 * la pagina non abbia piu' un formattatore proprio.
 */

const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
const EXPECTED_KEYS = [
  'title',
  'errorTitle',
  'errorBody',
  'eyebrow',
  'linkedCode',
  'sales',
  'revenue',
  'commission',
  'rate',
  'lastSale',
  'refundedOrders',
  'nextTier',
  'footer',
].sort()

function readNamespace(locale: string): Record<string, unknown> {
  const file = path.join(process.cwd(), 'messages', `${locale}.json`)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  const namespace = parsed.affiliateStats
  assert.ok(namespace && typeof namespace === 'object', `${locale}.json non ha affiliateStats`)
  return namespace as Record<string, unknown>
}

/**
 * Il traduttore vero di next-intl: i messaggi si leggono da disco a runtime,
 * quindi il tipo delle chiavi non puo' essere quello statico. La resa e' quella
 * di produzione (ICU), non una sostituzione artigianale che potrebbe divergere
 * dal sito.
 */
type Translate = (key: string, values?: Record<string, string>) => string

function translator(locale: string): Translate {
  const build = createTranslator as unknown as (options: {
    locale: string
    messages: unknown
    namespace: string
  }) => Translate
  return build({ locale, messages: JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as unknown, namespace: 'affiliateStats' })
}

/** Le righe di importo della pagina, con i valori come li legge il lettore. */
function moneyRows(locale: string): { revenue: string; commission: string } {
  return {
    revenue: formatEuroCents(locale, 123456),
    commission: formatEuroCents(locale, 3333),
  }
}

const STATS_PAGE = path.join(process.cwd(), 'src', 'app', '[locale]', 'a', '[slug]', 'stats', 'page.tsx')
const DATE_FORMAT = path.join(process.cwd(), 'src', 'lib', 'date-format.ts')

test('every locale carries the whole affiliateStats namespace', () => {
  for (const locale of LOCALES) {
    const namespace = readNamespace(locale)
    assert.deepEqual(Object.keys(namespace).sort(), EXPECTED_KEYS, `chiavi diverse in ${locale}.json`)
    for (const [key, value] of Object.entries(namespace)) {
      assert.equal(typeof value, 'string', `${locale}.${key} non e' una stringa`)
      assert.ok(String(value).trim() !== '', `${locale}.${key} e' vuota`)
    }
  }
})

test('the next tier sentence keeps its placeholders in every language', () => {
  for (const locale of LOCALES) {
    const sentence = String(readNamespace(locale).nextTier)
    for (const placeholder of ['{threshold}', '{missing}']) {
      assert.ok(sentence.includes(placeholder), `${locale}: manca ${placeholder} in nextTier`)
    }
  }
})

test('no translation falls back to showing the key itself', () => {
  for (const locale of LOCALES) {
    const namespace = readNamespace(locale)
    for (const key of EXPECTED_KEYS) {
      assert.notEqual(String(namespace[key]).trim(), key, `${locale}.${key} mostra la chiave`)
    }
  }
})

test('the italian strings match the page that was already published', () => {
  const italian = readNamespace('it')
  assert.equal(italian.sales, 'Vendite attribuite')
  assert.equal(italian.revenue, 'Fatturato eleggibile')
  assert.equal(italian.commission, 'Commissione maturata')
  assert.equal(italian.rate, 'Aliquota attuale')
  assert.equal(italian.lastSale, 'Ultima vendita')
})

// -------------------------------------------------- importi e percentuali

test('gli importi della pagina sono quelli di money.ts: simbolo fuori, una volta sola', () => {
  // La resa che il lettore vede, nelle cinque lingue. Il simbolo sta dopo il
  // numero e attaccato: `1.234,56€`, non `1.234,56 €` (currency style italiano)
  // e non `€1,234.56` (currency style inglese).
  const expected: Record<string, { revenue: string; commission: string }> = {
    it: { revenue: '1.234,56€', commission: '33,33€' },
    en: { revenue: '1,234.56€', commission: '33.33€' },
    // Il francese raggruppa con lo spazio fine insecabile (U+202F), non con lo
    // spazio normale: e' il separatore che Intl produce e che il lettore vede.
    fr: { revenue: '1\u202f234,56€', commission: '33,33€' },
    es: { revenue: '1.234,56€', commission: '33,33€' },
    de: { revenue: '1.234,56€', commission: '33,33€' },
  }
  for (const locale of LOCALES) {
    const rows = moneyRows(locale)
    assert.deepEqual(rows, expected[locale], `${locale}: la resa dell'importo non e' quella attesa`)
    for (const value of Object.values(rows)) {
      assert.equal(value.match(/€/g)?.length, 1, `${locale}: il simbolo euro compare ${value}`)
      assert.ok(!/\s€/.test(value), `${locale}: il simbolo e' staccato dal numero — «${value}»`)
      assert.ok(/\d€$/.test(value), `${locale}: il simbolo non e' attaccato al numero — «${value}»`)
    }
  }
})

test('le aliquote si leggono nella lingua, con i tag espliciti e due decimali solo se servono', () => {
  const expected: Record<string, { whole: string; fractional: string }> = {
    it: { whole: '5%', fractional: '12,5%' },
    en: { whole: '5%', fractional: '12.5%' },
    fr: { whole: '5%', fractional: '12,5%' },
    es: { whole: '5%', fractional: '12,5%' },
    de: { whole: '5%', fractional: '12,5%' },
  }
  for (const locale of LOCALES) {
    assert.equal(formatPercentBps(locale, 500), expected[locale].whole, `${locale}: 5%`)
    assert.equal(formatPercentBps(locale, 1250), expected[locale].fractional, `${locale}: 12,5%`)
  }
  // Un terzo di punto percentuale (333 punti base) e' la forma piu' lunga che
  // questa pagina puo' mostrare: due decimali, non uno arrotondato.
  assert.equal(formatPercentBps('it', 333), '3,33%')
  assert.equal(formatPercentBps('en', 333), '3.33%')
})

test('la frase del prossimo livello non raddoppia il simbolo euro', () => {
  // La frase approvata nei `messages` scrive `{threshold}` e `{missing}` senza
  // `€`: il simbolo arriva solo dal formattatore. Se la pagina aggiungesse il
  // simbolo (o usasse `style: 'currency'`), il lettore vedrebbe `1.234,56 €€`.
  for (const locale of LOCALES) {
    const namespace = readNamespace(locale)
    for (const key of EXPECTED_KEYS) {
      assert.ok(
        !String(namespace[key]).includes('€'),
        `${locale}.${key} scrive il simbolo euro nella traduzione: il simbolo lo mette money.ts — «${namespace[key]}»`,
      )
    }

    const t = translator(locale)
    const sentence = t('nextTier', {
      threshold: formatEuroCents(locale, 150000),
      missing: formatEuroCents(locale, 26544),
    })
    const euro = sentence.match(/€/g)?.length ?? 0
    assert.equal(euro, 2, `${locale}: «${sentence}» deve mostrare il simbolo una volta per importo`)
    assert.ok(!sentence.includes('€€'), `${locale}: simbolo raddoppiato — «${sentence}»`)
    assert.ok(!/\s€/.test(sentence), `${locale}: simbolo staccato dal numero — «${sentence}»`)
    assert.ok(!/\d+\.\d{2}€/.test(sentence) || locale === 'en', `${locale}: separatore decimale sbagliato — «${sentence}»`)
  }
})

test('la data si legge nella lingua della pagina, con i tag espliciti', () => {
  // Mezzogiorno locale: nessun fuso orario del sistema puo' spostare il giorno.
  const date = new Date(2026, 10, 12, 12, 0, 0)
  assert.equal(formatLongDate('it', date), '12 novembre 2026')
  assert.equal(formatLongDate('en', date), '12 November 2026')
  for (const locale of LOCALES) {
    const reference = new Intl.DateTimeFormat(MONEY_LOCALE_TAGS[locale], {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(date)
    assert.equal(
      formatLongDate(locale, date),
      reference,
      `${locale}: la data non e' quella di ${MONEY_LOCALE_TAGS[locale]}`,
    )
    assert.ok(!/Invalid/i.test(formatLongDate(locale, date)), `${locale}: data non valida in pagina`)
  }
  // Una data che non esiste e' un errore di programmazione, non un testo.
  assert.throws(() => formatLongDate('it', 'non-una-data'), /data non valida/)
})

// --------------------------------------------------------- guardie sorgente

test('la pagina non ha un formattatore proprio: importi, aliquote e date vengono da lib', () => {
  // Il difetto che questo test chiude si vede solo sul sorgente: le cinque
  // lingue rendono uguale con la lingua nuda e con il tag esplicito su questi
  // valori, quindi nessun confronto di stringhe puo' accorgersi che i tag
  // espliciti sono spariti. Il sorgente si legge GREZZO, commenti compresi: un
  // filtro che scarta righe fallisce aperto (una riga `*` e' codice valido) —
  // lezione della review della card madre.
  const source = fs.readFileSync(STATS_PAGE, 'utf8')

  for (const forbidden of ['Intl', 'NumberFormat', 'DateTimeFormat', 'toFixed', 'toLocaleString', 'globalThis']) {
    assert.ok(
      !source.includes(forbidden),
      `la pagina statistica non deve nominare ${forbidden}: formatta chi possiede la decisione (money.ts, date-format.ts)`,
    )
  }
  assert.ok(!/style:\s*'currency'|currency(Display)?:/.test(source), 'la pagina non deve decidere la forma del simbolo')
  assert.ok(!/formattersFor/.test(source), 'il formattatore locale della pagina non deve tornare')

  assert.ok(
    /import\s*\{\s*formatEuroCents\s*,\s*formatPercentBps\s*\}\s*from\s*'@\/lib\/money'/.test(source),
    'la pagina deve importare formatEuroCents e formatPercentBps da @/lib/money, senza alias',
  )
  assert.ok(
    /import\s*\{\s*formatLongDate\s*\}\s*from\s*'@\/lib\/date-format'/.test(source),
    'la pagina deve importare formatLongDate da @/lib/date-format',
  )

  // Le tre funzioni USATE, non solo gli import: una sostituzione di corpo lascia
  // gli import al loro posto con la suite verde. Ancorate a inizio riga con
  // l'indentazione esatta, cosi' una riga di commento che riporta il codice di
  // prima non soddisfa la guardia.
  assert.ok(
    /^ {2}const formatEuro = \(cents: number\): string => formatEuroCents\(locale, cents\)$/m.test(source),
    'gli importi devono passare per formatEuroCents con il locale della pagina',
  )
  assert.ok(
    /^ {2}const formatRate = \(bps: number\): string => formatPercentBps\(locale, bps\)$/m.test(source),
    'le aliquote devono passare per formatPercentBps con il locale della pagina',
  )
  assert.ok(
    /^ {2}const formatDate = \(value: string \| null\): string => \(value === null \? '—' : formatLongDate\(locale, value\)\)$/m.test(source),
    'le date devono passare per formatLongDate con il locale della pagina',
  )
  // I PUNTI D'USO, non solo la definizione delle tre funzioni. Misurato da una
  // review indipendente: scrivere `${formatEuro(cents)}€` nella riga del
  // fatturato, o `formatEuro(currentRateBps)` al posto di `formatRate`,
  // lasciava la suite verde — cioe' il simbolo doppio (il difetto che questa
  // card chiude) poteva rientrare senza che nessun test se ne accorgesse. Si
  // pinna il blocco delle righe per intero: ogni importo passa da `formatEuro`,
  // ogni aliquota da `formatRate`, e nessuno aggiunge un simbolo.
  const rowsBlock = source.match(/ {2}const rows: Array<\[string, string\]> = \[[\s\S]*?\n {2}\]/)
  assert.ok(rowsBlock, 'la tabella delle statistiche deve esistere: blocco `rows` non trovato')
  assert.equal(
    rowsBlock[0],
    [
      '  const rows: Array<[string, string]> = [',
      "    [t('sales'), String(stats.salesCount)],",
      "    [t('revenue'), formatEuro(stats.eligibleAmountCents)],",
      "    [t('commission'), formatEuro(stats.commissionAmountCents)],",
      "    [t('rate'), formatRate(currentRateBps)],",
      "    [t('lastSale'), formatDate(stats.lastPaidAt)],",
      '  ]',
    ].join('\n'),
    'le righe della tabella devono essere quelle pinnate: nessun importo con un simbolo aggiunto a mano e nessuna aliquota formattata come importo',
  )
  assert.ok(
    /^ {12}threshold: formatEuro\(nextThreshold\),$/m.test(source) &&
      /^ {12}missing: formatEuro\(missingToNext\),$/m.test(source),
    'la frase del prossimo livello deve ricevere i due importi da formatEuro (che porta il simbolo), non dalla frase',
  )
  // Nessuna conversione di unita' fatta a mano: i centesimi arrivano interi e i
  // punti base pure, la divisione per 100 la fa money.ts.
  assert.ok(!/\/ 100|cents \/$/.test(source), 'la pagina non deve convertire centesimi o punti base da sola')
})

test('le date hanno un solo formattatore, costruito sul tag esplicito', () => {
  const source = fs.readFileSync(DATE_FORMAT, 'utf8')
  const tagged = source.match(/new Intl\.DateTimeFormat\(MONEY_LOCALE_TAGS\[locale\],/g) ?? []
  assert.equal(tagged.length, 1, 'date-format.ts deve costruire il formattatore dal tag esplicito di money.ts')
  assert.equal(
    (source.match(/DateTimeFormat\(/g) ?? []).length,
    tagged.length,
    'nessun formattatore di data costruito senza `new` o fuori dal tag esplicito',
  )
  assert.ok(
    !/toLocaleString|toLocaleDateString/.test(source),
    'date-format.ts non deve formattare con `toLocaleDateString`: il tag esplicito e\' la sola strada',
  )
  const imports = [...source.matchAll(/^import\s.*$/gm)].map((m) => m[0])
  assert.deepEqual(
    imports,
    ["import { MONEY_LOCALE_TAGS, normalizeMoneyLocale, type MoneyLocale } from './money'"],
    'date-format.ts deve prendere i tag da money.ts: una seconda lista di lingue e\' la deriva che questa card chiude',
  )
  // Il fuso orario non si fissa: la resa resta quella della pagina di prima
  // (istante formattato nel fuso del server). Pinnarlo qui impedisce che un
  // refactor successivo sposti di un giorno le date vicine alla mezzanotte
  // credendo di fare chiarezza.
  assert.ok(!/timeZone/.test(source), 'date-format.ts non deve fissare un fuso orario: cambierebbe la data mostrata')
})

test('le lingue della pagina statistica sono quelle pubblicate dal negozio', () => {
  assert.deepEqual([...LOCALES], [...MONEY_LOCALES])
  for (const locale of LOCALES) {
    assert.ok(MONEY_LOCALE_TAGS[locale], `${locale}: manca il tag esplicito in money.ts`)
  }
})
