import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

import { ProductDetail } from '../components/ProductDetail'
import type { Product } from '../lib/cms'
import { formatMoney, formatWholeMoney } from '../lib/money'
import { flatShippingCostEuros, freeShippingThresholdEuros } from '../lib/free-shipping-badge'
import { IMPORT_DUTIES_ENV_VAR, importDutiesMode } from '../lib/shipping'
import { routing } from '../i18n/routing'

/**
 * La scheda prodotto ha una sola promessa di consegna, e questo file la tiene
 * ferma in due modi che nessun typecheck copre:
 *
 *  1. **guardia sul sorgente** — il calcolo locale `productionDays + shippingDays`
 *     (la seconda stima, senza zona, senza cutoff, senza festivi) non deve
 *     tornare in `ProductDetail.tsx`; ne' le chiavi `shipsIn`/`madeToOrderDesc`,
 *     ne' un numero di giorni inventato quando il CMS non lo fornisce;
 *  2. **scheda resa davvero** (`renderToStaticMarkup` + `next-intl`) — una sola
 *     fascia Italia/UE, una sola fascia extra-UE, una sola frase doganale,
 *     costi e soglie formattati dalla fonte unica, e nessun italiano nella
 *     versione tedesca.
 *
 * La scelta fra copy DDP e DAP passa dall'interruttore condiviso col prezzo
 * (`importDutiesMode()` in `shipping.ts`, default DDP): il test verifica che
 * spento mostri la frase «inclusi» e acceso quella «a carico del destinatario»,
 * mai tutte e due insieme.
 */

const LOCALES = ['it', 'en', 'de', 'fr', 'es'] as const
type Locale = (typeof LOCALES)[number]

const COMPONENT = path.join(process.cwd(), 'src', 'components', 'ProductDetail.tsx')
const PRODUCT_PAGE = path.join(process.cwd(), 'src', 'app', '[locale]', 'prodotto', '[slug]', 'page.tsx')

function read(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

/** Il sorgente senza commenti: i commenti raccontano la storia, non la eseguono. */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
}

function messagesOf(locale: Locale): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'messages', `${locale}.json`), 'utf8')) as Record<string, unknown>
}

function productNamespace(locale: Locale): Record<string, unknown> {
  const product = messagesOf(locale).product
  assert.ok(product !== null && typeof product === 'object', `${locale}.json non ha il namespace product`)
  return product as Record<string, unknown>
}

function resolve(namespace: Record<string, unknown>, dotted: string): string {
  let current: unknown = namespace
  for (const part of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : ''
}

/** Testo visibile: via i tag, via le entita' che next-intl/React scrivono. */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  return haystack.split(needle).length - 1
}

/** Prodotto minimo: la scheda DBL come arriva dal CMS, senza rete nel test. */
function fixture(overrides: Partial<Product> = {}): Product {
  return {
    id: '33',
    name: 'T-Sheet Skin -DBL-',
    slug: 't-sheet-dbl',
    section: 'tattoo',
    active: true,
    limitedStock: false,
    madeToOrder: false,
    productionDays: 2,
    shippingDays: 3,
    order: 1,
    shortDescription: null as unknown as undefined,
    description: null,
    images: [],
    basePrice: 12.9,
    variants: [
      { sku: 'DBL', label: 'Standard', price: 12.9, stockStatus: 'available', validCombinations: [] },
    ],
    attributes: [],
    ...overrides,
  }
}

function renderDetail(locale: Locale, importDuties: 'DDP' | 'DAP', overrides: Partial<Product> = {}): string {
  const html = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider as never,
      { locale, messages: messagesOf(locale), timeZone: 'Europe/Rome' } as never,
      createElement(ProductDetail as never, { product: fixture(overrides), importDuties } as never),
    ),
  )
  return visibleText(html)
}

function localizedLine(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  let text = resolve(productNamespace(locale), key)
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{${name}}`).join(String(value))
  }
  return text
}

// ─── 1. Guardia sul sorgente ─────────────────────────────────────────────────

test('ProductDetail non ricalcola la consegna in locale: niente productionDays + shippingDays', () => {
  const source = code(COMPONENT)
  const problems: string[] = []

  if (/\bshippingDays\b/.test(source)) {
    problems.push('usa `shippingDays`: la stima locale (produzione + spedizione) e\' tornata')
  }
  for (const pattern of [
    /\bproductionDays\s*[-+*/]/,
    /[-+*/]\s*productionDays\b/,
    /\bproductionDays\b\s*\?\?/,
    /\b(?:productionDays|shippingDays|days)\b\s*\?\?\s*\d+/,
    /\bMath\.(?:ceil|round|floor)\(\s*[^)]*productionDays[^)]*[-+*/]/,
  ]) {
    if (pattern.test(source)) problems.push(`aritmetica su productionDays (${pattern})`)
  }
  for (const legacy of ['shipsIn', 'madeToOrderDesc']) {
    if (source.includes(legacy)) problems.push(`usa la chiave legacy \`${legacy}\``)
  }
  if (/estimateCartDelivery/.test(source)) {
    problems.push('chiama estimateCartDelivery dentro la scheda: in scheda il paese non e\' noto, si dichiara la fascia')
  }

  assert.deepEqual(problems, [], `seconda stima di consegna nel componente:\n${problems.join('\n')}`)
})

test('ProductDetail non contiene stringhe italiane fisse nel JSX', () => {
  const source = code(COMPONENT)
  const problems: string[] = []
  for (const phrase of ['Aggiunto al carrello', 'Su ordinazione', 'Disponibile', 'Aggiungi al carrello', 'giorni lavorativi']) {
    // Il testo puo' stare solo in messages/*.json, mai in un letterale del componente.
    if (source.includes(`'${phrase}'`) || source.includes(`"${phrase}"`) || source.includes(`\`${phrase}`)) {
      problems.push(`stringa fissa «${phrase}»`)
    }
  }
  assert.deepEqual(problems, [], `italiano cablato nel componente:\n${problems.join('\n')}`)
})

test('la modalita doganale arriva dal server con l interruttore condiviso col prezzo', () => {
  const component = code(COMPONENT)
  const page = code(PRODUCT_PAGE)
  assert.match(
    component,
    /importDuties\?:\s*ImportDutiesMode/,
    'ProductDetail deve ricevere `importDuties` dal server, non leggerlo dal client',
  )
  assert.match(page, /importDuties=\{\s*importDutiesMode\(\)\s*\}/, 'la pagina deve passare importDutiesMode()')
  assert.match(page, /import\s*\{\s*importDutiesMode\s*\}\s*from\s*'@\/lib\/shipping'/)
})

test('un solo punto decide fra copy DDP e DAP, e sono mutuamente esclusive', () => {
  const source = code(COMPONENT)
  assert.equal(countOccurrences(source, "t('delivery.bandEu')"), 1, 'una sola fascia Italia/UE')
  assert.equal(countOccurrences(source, "t('delivery.bandExtraEu')"), 1, 'una sola fascia extra-UE')
  assert.equal(countOccurrences(source, "t('shippingCost.extraEuDap')"), 1)
  assert.equal(countOccurrences(source, "t('shippingCost.extraEuDdp')"), 1)
  assert.match(
    source,
    /importDuties === 'DAP'\s*\?\s*t\('shippingCost\.extraEuDap'\)\s*:\s*t\('shippingCost\.extraEuDdp'\)/,
    'la scelta deve essere un ternario unico sull\'interruttore, non due frasi affiancate',
  )
})

test('le chiavi product usate dalla scheda esistono e non sono vuote in tutte e cinque le lingue', () => {
  const source = code(COMPONENT)
  const used = [...source.matchAll(/\bt\('([a-zA-Z0-9_.]+)'/g)].map((match) => match[1])
  const unique = [...new Set(used)].sort()
  assert.ok(unique.length >= 25, `la scheda dovrebbe usare le chiavi tradotte, trovate ${unique.length}`)

  const problems: string[] = []
  for (const locale of LOCALES) {
    const product = productNamespace(locale)
    for (const key of unique) {
      const value = resolve(product, key)
      if (value === '') problems.push(`${locale}: product.${key} assente o vuota`)
    }
  }
  assert.deepEqual(problems, [], `chiavi usate dalla scheda mancanti:\n${problems.join('\n')}`)
  assert.deepEqual([...LOCALES].sort(), [...routing.locales].sort(), 'le lingue del test devono essere quelle pubblicate')
})

// ─── 2. Interruttore doganale ────────────────────────────────────────────────

test('importDutiesMode e spento per default e accende il DAP solo con DAP nell ambiente', () => {
  const previous = process.env[IMPORT_DUTIES_ENV_VAR]
  try {
    delete process.env[IMPORT_DUTIES_ENV_VAR]
    assert.equal(importDutiesMode(), 'DDP', 'senza variabile si resta DDP: e\' quello che il prezzo applica oggi')
    for (const off of ['', '  ', 'DDP', 'ddp', 'off', 'false', '0', 'dap2']) {
      process.env[IMPORT_DUTIES_ENV_VAR] = off
      assert.equal(importDutiesMode(), 'DDP', `«${off}» non deve accendere il DAP`)
    }
    for (const on of ['DAP', 'dap', ' DAP ', 'Dap']) {
      process.env[IMPORT_DUTIES_ENV_VAR] = on
      assert.equal(importDutiesMode(), 'DAP', `«${on}» deve accendere il DAP`)
    }
  } finally {
    if (previous === undefined) delete process.env[IMPORT_DUTIES_ENV_VAR]
    else process.env[IMPORT_DUTIES_ENV_VAR] = previous
  }
})

// ─── 3. Scheda resa: una sola stima, costi, dazi, nessun italiano in tedesco ──

test('la scheda resa mostra una sola fascia di consegna per lingua, con costi e soglie dalla fonte unica', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const text = renderDetail(locale, 'DDP')
    const bandEu = localizedLine(locale, 'delivery.bandEu')
    const bandExtraEu = localizedLine(locale, 'delivery.bandExtraEu')

    if (countOccurrences(text, bandEu) !== 1) {
      problems.push(`${locale}: «${bandEu}» compare ${countOccurrences(text, bandEu)} volte invece di 1`)
    }
    if (countOccurrences(text, bandExtraEu) !== 1) {
      problems.push(`${locale}: «${bandExtraEu}» compare ${countOccurrences(text, bandExtraEu)} volte invece di 1`)
    }

    // Un solo marcatore di fascia: se una seconda stima entrasse in pagina, qui
    // comparirebbe due volte.
    if (countOccurrences(text, '24–48') !== 1) problems.push(`${locale}: «24–48» compare ${countOccurrences(text, '24–48')} volte`)
    if (countOccurrences(text, '4–6 ') !== 1) problems.push(`${locale}: «4–6 » compare ${countOccurrences(text, '4–6 ')} volte`)

    const italy = localizedLine(locale, 'shippingCost.italy', {
      cost: formatMoney(locale, flatShippingCostEuros('IT')),
      threshold: formatWholeMoney(locale, freeShippingThresholdEuros('IT')),
    })
    const eu = localizedLine(locale, 'shippingCost.eu', {
      cost: formatMoney(locale, flatShippingCostEuros('EU')),
      threshold: formatWholeMoney(locale, freeShippingThresholdEuros('EU')),
    })
    if (countOccurrences(text, italy) !== 1) problems.push(`${locale}: riga spedizione Italia non resa una volta — «${italy}»`)
    if (countOccurrences(text, eu) !== 1) problems.push(`${locale}: riga spedizione UE non resa una volta — «${eu}»`)
  }
  assert.deepEqual(problems, [], `fasce o costi di consegna fuori posto:\n${problems.join('\n')}`)
})

test('interruttore spento mostra la copy DDP, acceso mostra la DAP: mai tutte e due', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const ddp = localizedLine(locale, 'shippingCost.extraEuDdp')
    const dap = localizedLine(locale, 'shippingCost.extraEuDap')

    const withDdp = renderDetail(locale, 'DDP')
    const withDap = renderDetail(locale, 'DAP')

    if (countOccurrences(withDdp, ddp) !== 1) problems.push(`${locale}: con l'interruttore spento manca la copy DDP`)
    if (countOccurrences(withDdp, dap) !== 0) problems.push(`${locale}: con l'interruttore spento compare gia' la copy DAP`)
    if (countOccurrences(withDap, dap) !== 1) problems.push(`${locale}: con l'interruttore acceso manca la copy DAP`)
    if (countOccurrences(withDap, ddp) !== 0) problems.push(`${locale}: con l'interruttore acceso resta anche la copy DDP`)
  }
  assert.deepEqual(problems, [], `stati intermedi fra DDP e DAP:\n${problems.join('\n')}`)
})

test('il tempo di produzione compare una volta sola, e solo se il CMS lo dichiara', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const withProduction = renderDetail(locale, 'DDP', { madeToOrder: true, productionDays: 2 })
    const expected = localizedLine(locale, 'delivery.productionExtra', { days: 2 })
    if (countOccurrences(withProduction, expected) !== 1) {
      problems.push(`${locale}: riga di produzione mancante o duplicata — «${expected}»`)
    }

    const onOrderMissingDays = renderDetail(locale, 'DDP', { madeToOrder: true, productionDays: null as unknown as undefined })
    const invented = localizedLine(locale, 'delivery.productionExtra', { days: 3 })
    if (countOccurrences(onOrderMissingDays, 'giorni lavorativi di produzione') > 0 && locale === 'it') {
      problems.push('it: con productionDays assente la scheda inventa comunque una riga di produzione')
    }
    if (countOccurrences(onOrderMissingDays, invented) > 0) {
      problems.push(`${locale}: con productionDays assente compare un numero inventato («${invented}»)`)
    }
  }
  assert.deepEqual(problems, [], `tempo di produzione fuori contratto:\n${problems.join('\n')}`)
})

test('nella scheda tedesca non resta nessuna frase italiana', () => {
  const italian = productNamespace('it')
  const germanText = renderDetail('de', 'DDP')
  const problems: string[] = []

  // Le frasi italiane che il componente rende direttamente: se una sola
  // arrivasse in tedesco, la scheda sembrerebbe tradotta e non lo sarebbe.
  const italianPhrases = [
    resolve(italian, 'delivery.bandEu'),
    resolve(italian, 'delivery.bandExtraEu'),
    resolve(italian, 'delivery.productionExtra').replace('{days}', '2'),
    resolve(italian, 'shippingCost.extraEuDdp'),
    resolve(italian, 'tech.stencil'),
    resolve(italian, 'tech.discromie'),
    resolve(italian, 'tech.thickness'),
    resolve(italian, 'tech.translucency'),
    resolve(italian, 'available'),
    resolve(italian, 'onOrder'),
  ]
  for (const phrase of italianPhrases) {
    if (phrase !== '' && germanText.includes(phrase)) problems.push(`frase italiana in DE: «${phrase}»`)
  }
  for (const word of ['giorni lavorativi', 'Spedizione', 'dazi e IVA', 'carrello', 'Aggiungi al carrello']) {
    if (germanText.includes(word)) problems.push(`parola italiana in DE: «${word}»`)
  }

  // Controprova: la versione tedesca deve davvero contenere il tedesco.
  if (!germanText.includes(resolve(productNamespace('de'), 'delivery.bandEu'))) {
    problems.push('DE non mostra la fascia tedesca: il test non sta guardando la pagina giusta')
  }
  assert.deepEqual(problems, [], `italiano nella scheda tedesca:\n${problems.join('\n')}`)
})
