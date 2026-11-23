import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

/**
 * La disponibilita' di un prodotto e' il punto in cui il negozio prende un
 * impegno con il cliente: quando parte il pacco e in quanto arriva. Quella
 * promessa viveva in tre posti diversi e si contraddiceva — la pagina prodotto
 * diceva «Spedito in {days} giorni lavorativi», i termini «3–5 giorni
 * lavorativi», la home «24–48h» senza dire da dove parte. Chi leggeva tre
 * numeri diversi non aveva modo di sapere quale fosse vero.
 *
 * Questo file tiene la promessa in un posto solo e la difende su due fronti:
 *
 *  1. nel catalogo dei messaggi — le chiavi esistono in tutte e cinque le
 *     lingue, portano i segnaposto giusti, e la vecchia promessa «3–5 giorni»
 *     non deve ricomparire in nessuna delle sue varianti linguistiche;
 *  2. nel sorgente — ProductDetail.tsx non deve piu' contenere testo visibile
 *     scritto a mano: un letterale nel JSX resta italiano per tutti, anche
 *     quando i messaggi sono tradotti.
 *
 * L'analisi del sorgente usa il TypeScript gia' nel repo (come
 * checkout-i18n.test.ts), nessuna dipendenza nuova.
 */

const LOCALES = ['it', 'en', 'de', 'fr', 'es'] as const

const COMPONENT = path.join('src', 'components', 'ProductDetail.tsx')
const COMPONENT_FILE = path.join(process.cwd(), COMPONENT)

/** Le chiavi che questa card ha deciso, con il namespace davanti. */
const REQUIRED_KEYS = [
  'product.availableBadge',
  'product.availableDelivery',
  'product.madeToOrderBadge',
  'product.madeToOrderDelivery',
  'product.madeToOrderProductionUnknown',
  'checkout.deliveryEstimate',
  'checkout.deliveryTransitItEu',
  'checkout.deliveryTransitExtraEu',
  'termini.shippingText',
  'home.badges.shippingSpeed.title',
  'home.badges.shippingSpeed.body',
] as const

/** Le chiavi che la promessa vecchia usava: rimosse, e devono restare fuori. */
const REMOVED_KEYS = ['product.shipsIn', 'product.madeToOrderDesc'] as const

/** Il vecchio range di produzione, comprese le varianti di lingua e unità. */
const LEGACY_RANGE_PATTERNS = [
  /\b3\s*(?:[-–—]\s*5|(?:to|bis|à|a)\s+5)\s*(?:(?:business|working|work)\s+)?(?:days?|calendar\s+days?|giorni(?:\s+lavorativi)?|jours?(?:\s+ouvrés?)?|días?(?:\s+(?:hábiles|laborables))?|dias?(?:\s+laborables?)?|tage?|werktage)\b/iu,
]

function findLegacyRange(text: string): boolean {
  return LEGACY_RANGE_PATTERNS.some((pattern) => pattern.test(text))
}

// ─── Catalogo messaggi ──────────────────────────────────────────────────────

function readCatalog(locale: string): Record<string, unknown> {
  const file = path.join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
}

function resolveKey(catalog: Record<string, unknown>, dotted: string): unknown {
  let current: unknown = catalog
  for (const part of dotted.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** Percorsi foglia, cosi' anche i sotto-namespace (`badges`, `shippingRates`) contano. */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenKeys(child, prefix ? `${prefix}.${key}` : key),
    )
  }
  return [prefix]
}

/** Ogni stringa del catalogo, con il percorso che la nomina. */
function flattenValues(value: unknown, prefix = ''): Array<{ key: string; text: string }> {
  if (typeof value === 'string') return [{ key: prefix, text: value }]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenValues(child, prefix ? `${prefix}.${key}` : key),
    )
  }
  return []
}

test('le chiavi della disponibilita esistono, non sono vuote, in tutte e cinque le lingue', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale)
    for (const dotted of REQUIRED_KEYS) {
      const value = resolveKey(catalog, dotted)
      assert.equal(typeof value, 'string', `${locale}.json non ha ${dotted}`)
      assert.ok(String(value).trim() !== '', `${locale}.json: ${dotted} e' vuota`)
    }
  }
})

test('product e checkout hanno le stesse chiavi in tutte e cinque le lingue', () => {
  for (const namespace of ['product', 'checkout']) {
    const reference = flattenKeys(readCatalog('it')[namespace]).sort()
    assert.ok(reference.length > 5, `il namespace ${namespace} dovrebbe essere popolato: ${reference.length} chiavi`)
    for (const locale of LOCALES) {
      assert.deepEqual(
        flattenKeys(readCatalog(locale)[namespace]).sort(),
        reference,
        `chiavi diverse in ${locale}.json (namespace ${namespace})`,
      )
    }
  }
})

test('le chiavi della vecchia promessa non esistono piu', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale)
    for (const dotted of REMOVED_KEYS) {
      assert.equal(
        resolveKey(catalog, dotted),
        undefined,
        `${locale}.json espone ancora ${dotted}: la promessa vive nelle chiavi nuove`,
      )
    }
  }
})

test('i segnaposto che portano una durata ci sono in ogni lingua', () => {
  const placeholders: Record<string, string> = {
    'product.madeToOrderDelivery': '{productionDays}',
    'checkout.deliveryEstimate': '{date}',
  }
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale)
    for (const [dotted, placeholder] of Object.entries(placeholders)) {
      const value = resolveKey(catalog, dotted)
      assert.equal(typeof value, 'string', `${locale}.json non ha ${dotted}`)
      assert.ok(
        String(value).includes(placeholder),
        `${locale}: manca ${placeholder} in ${dotted}: ${JSON.stringify(value)}`,
      )
    }
  }
})

test('nessun messaggio promette piu il vecchio intervallo 3–5', () => {
  const found: string[] = []
  for (const locale of LOCALES) {
    for (const { key, text } of flattenValues(readCatalog(locale))) {
      if (findLegacyRange(text)) found.push(`${locale}.json ${key}: ${JSON.stringify(text)}`)
    }
  }
  assert.deepEqual(found, [], `il vecchio intervallo e' ancora nel catalogo:\n  ${found.join('\n  ')}`)
})

test('la guardia avversariale intercetta il range in tutte le lingue e le unità equivalenti', () => {
  const legacyVariants = [
    '3–5 giorni',
    '3-5 giorni lavorativi',
    '3 to 5 days',
    '3–5 business days',
    '3-5 working days',
    '3 bis 5 Werktage',
    '3 à 5 jours ouvrés',
    '3 a 5 días hábiles',
    '3–5 días laborables',
    '3–5 calendar days',
  ]
  for (const phrase of legacyVariants) {
    assert.equal(findLegacyRange(phrase), true, `range non intercettato: ${phrase}`)
  }

  const nonLegacyVariants = [
    '4–6 giorni lavorativi',
    '24–48 ore lavorative',
    'da 3 a 5 prodotti',
    '3–5%',
  ]
  for (const phrase of nonLegacyVariants) {
    assert.equal(findLegacyRange(phrase), false, `falso positivo: ${phrase}`)
  }
})

test('la partenza e la consegna dichiarano la stessa finestra in ogni lingua', () => {
  // Il difetto vero non era un numero sbagliato: erano tre numeri diversi.
  // Chi parte dichiara 24–48 ore, chi va fuori UE 4–6 giorni, e i due testi
  // devono dirlo con gli stessi numeri in tutte le lingue.
  const windows: Record<string, string> = {
    'product.availableDelivery': '24–48',
    'checkout.deliveryTransitItEu': '24–48',
    'checkout.deliveryTransitExtraEu': '4–6',
    'termini.shippingText': '4–6',
  }
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale)
    for (const [dotted, window] of Object.entries(windows)) {
      const value = String(resolveKey(catalog, dotted) ?? '')
      assert.ok(value.includes(window), `${locale}: ${dotted} non dichiara ${window}: ${JSON.stringify(value)}`)
    }
    // I termini contengono entrambe le regole: dentro e fuori UE.
    const termini = String(resolveKey(catalog, 'termini.shippingText') ?? '')
    assert.ok(termini.includes('24–48'), `${locale}: termini.shippingText non dichiara 24–48`)
  }
})

test('la home comunica la partenza, non una zona di consegna senza conoscere l\'indirizzo', () => {
  for (const locale of LOCALES) {
    const catalog = readCatalog(locale)
    const title = String(resolveKey(catalog, 'home.badges.shippingSpeed.title') ?? '')
    const body = String(resolveKey(catalog, 'home.badges.shippingSpeed.body') ?? '')
    assert.match(title, /24/, `${locale}: la home deve limitarsi al tempo di partenza`)
    assert.doesNotMatch(`${title} ${body}`, /24\s*[–-]\s*48|4\s*[–-]\s*6/, `${locale}: la home non conosce la zona di consegna`)
    assert.match(body, /carrello|carrito|warenkorb|panier|cart/i, `${locale}: la data di consegna va rimandata al carrello`)
  }
})

// ─── Guardia sul sorgente ───────────────────────────────────────────────────

/**
 * Attributi il cui valore e' testo che il cliente legge davvero. `aria-label`
 * sta qui perche' un lettore di schermo lo pronuncia: scritto a mano resta
 * italiano anche quando il resto della pagina e' tradotto, quindi e' testo
 * visibile al cliente a tutti gli effetti.
 */
const VISIBLE_ATTRIBUTES = new Set(['placeholder', 'title', 'alt', 'aria-label'])

/**
 * Testi che il browser mostra ma che non sono prosa da tradurre: un separatore
 * di valuta, il `max` accanto a un contatore, una sigla, una data ISO. Ognuno
 * di questi ha un test che lo nomina, cosi' se un domani qualcuno ci scrive una
 * frase dentro, la guardia la vede.
 */
const ALLOWED_LITERAL = [
  /^[\s€$.,\d+−-]*$/, // solo importi, cifre e simboli
  /^\d{4}-\d{2}-\d{2}$/, // date ISO
  /^(?:max|qty|sku|it|en|de|fr|es)$/i, // segnaposto e sigle tecniche
] as const

const VALUE_OPERATORS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

/** `t(...)`, `t.rich(...)` e i traduttori di namespace (`tFreeShippingBadge`, ...). */
const TRANSLATION_CALLEE = /^t$|^t[A-Z]/

interface Violation {
  line: number
  text: string
  why: string
}

function parseSource(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function hasLetter(text: string): boolean {
  return /\p{L}/u.test(text)
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
    return expression.expression.text
  }
  return null
}

function isInsideTranslationCall(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent
  while (current) {
    if (ts.isCallExpression(current)) {
      const name = calleeName(current.expression)
      return name !== null && TRANSLATION_CALLEE.test(name)
    }
    if (
      ts.isJsxExpression(current) ||
      ts.isJsxAttribute(current) ||
      ts.isJsxElement(current) ||
      ts.isJsxFragment(current) ||
      ts.isStatement(current)
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

function isRenderedValue(node: ts.Node): boolean {
  let current: ts.Node = node
  let parent: ts.Node | undefined = node.parent
  while (parent) {
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isNonNullExpression(parent)
    ) {
      current = parent
      parent = parent.parent
      continue
    }
    if (ts.isConditionalExpression(parent)) {
      if (parent.condition === current) return false
      current = parent
      parent = parent.parent
      continue
    }
    if (ts.isBinaryExpression(parent)) {
      if (!VALUE_OPERATORS.has(parent.operatorToken.kind)) return false
      current = parent
      parent = parent.parent
      continue
    }
    if (
      ts.isCallExpression(parent) ||
      ts.isNewExpression(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)
    ) {
      return false
    }
    if (ts.isJsxExpression(parent)) {
      const owner = parent.parent
      if (owner && ts.isJsxAttribute(owner)) return VISIBLE_ATTRIBUTES.has(owner.name.getText())
      return !!owner && (ts.isJsxElement(owner) || ts.isJsxFragment(owner))
    }
    if (ts.isJsxAttribute(parent)) return VISIBLE_ATTRIBUTES.has(parent.name.getText())
    return false
  }
  return false
}

function isAllowedLiteral(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return true
  return ALLOWED_LITERAL.some((pattern) => pattern.test(trimmed))
}

/** Testo letterale visibile al cliente e non tradotto, dentro un sorgente JSX. */
function findUntranslatedText(fileName: string, source: string): Violation[] {
  const sourceFile = parseSource(fileName, source)
  const violations: Violation[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim()
      if (hasLetter(text) && !isAllowedLiteral(text)) {
        violations.push({ line: lineOf(sourceFile, node), text, why: 'testo JSX scritto a mano' })
      }
      return
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text
      if (hasLetter(text) && isRenderedValue(node) && !isInsideTranslationCall(node) && !isAllowedLiteral(text)) {
        const why = ts.isNoSubstitutionTemplateLiteral(node) ? 'template letterale nel JSX' : 'stringa letterale nel JSX'
        violations.push({ line: lineOf(sourceFile, node), text, why })
      }
      return
    }

    if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      const text = parts.join('').trim()
      if (text && hasLetter(text) && isRenderedValue(node) && !isInsideTranslationCall(node) && !isAllowedLiteral(text)) {
        violations.push({ line: lineOf(sourceFile, node), text, why: 'frase composta a mano nel JSX' })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations.sort((a, b) => a.line - b.line)
}

/** Le chiavi passate a `t('...')` nel componente: quelle che il runtime risolve. */
function collectTranslationKeys(fileName: string, source: string): Array<{ key: string; line: number }> {
  const sourceFile = parseSource(fileName, source)
  const keys: Array<{ key: string; line: number }> = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 't') {
      const [first] = node.arguments
      if (first && ts.isStringLiteralLike(first)) {
        keys.push({ key: first.text, line: lineOf(sourceFile, node) })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return keys
}

/**
 * I letterali che il componente scriveva a mano: il glifo e il testo stanno
 * nella traduzione, e la guardia deve vederli anche se qualcuno li ricompone
 * con un'entita' HTML o una stringa condizionale (per questo si cerca la
 * sottostringa nel sorgente grezzo, non nel testo renderizzato).
 */
const HARDCODED_BADGE_LITERALS = ['✦ Su ordinazione', '● Disponibile'] as const

/** I letterali scritti a mano presenti nel sorgente, nell'ordine dichiarato. */
function findHardcodedBadge(source: string): string[] {
  return HARDCODED_BADGE_LITERALS.filter((literal) => source.includes(literal))
}

test('ProductDetail non contiene piu il badge scritto a mano', () => {
  const source = fs.readFileSync(COMPONENT_FILE, 'utf8')
  assert.deepEqual(
    findHardcodedBadge(source),
    [],
    `${COMPONENT} contiene ancora il badge italiano scritto a mano: il glifo e il testo stanno nella traduzione`,
  )
})

test('la guardia sul badge vede il difetto quando c\'e\' e tace quando non c\'e\'', () => {
  // La sottostringa grezza e' l'unica forma che intercetta il difetto vero: il
  // test si prova su un sorgente che lo riproduce, non solo su quello sano.
  assert.deepEqual(findHardcodedBadge('<span>● Disponibile</span>'), ['● Disponibile'])
  assert.deepEqual(findHardcodedBadge('<span>✦ Su ordinazione</span>'), ['✦ Su ordinazione'])
  assert.deepEqual(findHardcodedBadge('<span>{t(\'availableBadge\')}</span>'), [])
})

test('ProductDetail non ha testo visibile scritto a mano fuori da t(...)', () => {
  const source = fs.readFileSync(COMPONENT_FILE, 'utf8')
  const violations = findUntranslatedText(COMPONENT, source)
  const detail = violations.map((v) => `  ${COMPONENT}:${v.line} — ${v.why}: ${JSON.stringify(v.text)}`).join('\n')
  assert.equal(violations.length, 0, `stringhe non tradotte nella pagina prodotto:\n${detail}`)
})

test('la guardia riconosce il difetto che deve riconoscere', () => {
  // Un guardiano che non sa vedere una frase scritta a mano renderebbe verde
  // per caso il test sopra. Si prova su un frammento che riproduce il difetto
  // vero, piu' i falsi positivi che non deve produrre.
  const broken = `
    export default function Card() {
      const t = useTranslations('product')
      const label = 'Aggiunto'
      return (
        <div className="rounded-xl">
          <span>● Ultimi pezzi</span>
          <span>{added ? 'Aggiunto' : 'Aggiungi'}</span>
          <span>{\`Risparmi €\${amount}\`}</span>
          <span>{formatMoney(locale, price)}€</span>
          <span>max {maxQty}</span>
          <button aria-label="Chiudi">×</button>
          <svg strokeWidth={1.5} fill="white" />
          <span>{t('availableBadge')}</span>
          <span style={{ color: 'var(--muted-fg)' }}>{t('quantity')}</span>
        </div>
      )
    }
  `
  const violations = findUntranslatedText('broken.tsx', broken)
  const texts = violations.map((v) => v.text)
  for (const expected of ['● Ultimi pezzi', 'Aggiunto', 'Aggiungi', 'Chiudi']) {
    assert.ok(texts.includes(expected), `la guardia non ha visto ${JSON.stringify(expected)}: ${JSON.stringify(texts)}`)
  }
  assert.ok(
    texts.some((text) => text.startsWith('Risparmi')),
    `la guardia non ha visto la frase composta con importo: ${JSON.stringify(texts)}`,
  )
  // ...e non deve segnalare cio' che e' tradotto, cio' che non e' testo, gli
  // attributi tecnici e i valori ammessi. `Chiudi` non e' piu' fra questi:
  // e' un `aria-label` scritto a mano, quindi va visto.
  for (const allowed of ['availableBadge', 'quantity', 'rounded-xl', 'var(--muted-fg)', '€', 'max']) {
    assert.ok(!texts.includes(allowed), `falso positivo su ${JSON.stringify(allowed)}`)
  }
})

test('ogni chiave usata dal componente esiste in tutte e cinque le lingue', () => {
  const source = fs.readFileSync(COMPONENT_FILE, 'utf8')
  const keys = collectTranslationKeys(COMPONENT, source)
  assert.ok(keys.length >= 20, `il componente dovrebbe usare il namespace product: trovate ${keys.length} chiavi`)

  for (const locale of LOCALES) {
    const namespace = readCatalog(locale).product as Record<string, unknown>
    for (const { key, line } of keys) {
      const value = resolveKey(namespace, key)
      assert.equal(typeof value, 'string', `${locale}.json non ha product.${key} (${COMPONENT}:${line})`)
      assert.ok(String(value).trim() !== '', `${locale}.json: product.${key} e' vuota (${COMPONENT}:${line})`)
    }
  }
})
