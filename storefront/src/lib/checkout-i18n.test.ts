import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import ts from 'typescript'

/**
 * Il checkout e' l'unica pagina del negozio dove una parola fraintesa costa un
 * rimborso: soldi e spedizione devono parlare la lingua dell'utente, non quella
 * di chi ha scritto il JSX.
 *
 * Due difetti diversi si nascondono qui, e nessuno dei due lo vede un test che
 * legge solo i messaggi:
 *
 *  1. una chiave aggiunta in una lingua e dimenticata in un'altra non rompe
 *     niente a build time: la pagina mostra la chiave grezza (o lancia) in una
 *     lingua sola;
 *  2. una frase scritta a mano dentro il JSX non passa da `t(...)`, quindi
 *     resta italiana per tutti anche se i messaggi sono tradotti — ed e' cosi'
 *     che il riepilogo d'ordine diceva «Subtotale», «Spedizione», «Gratuita»,
 *     «Totale IVA inc.» a un cliente francese che stava pagando.
 *
 * Il secondo si trova solo guardando il sorgente, ed e' quello che fa questo
 * file: analizza l'AST della pagina con il TypeScript gia' nel repo (nessuna
 * dipendenza nuova) e rifiuta qualunque testo letterale che finisca sotto gli
 * occhi del cliente fuori da una chiamata di traduzione.
 */

const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

const PAGE = path.join('src', 'app', '[locale]', 'checkout', 'page.tsx')
const PAGE_FILE = path.join(process.cwd(), PAGE)

/** Attributi il cui valore e' testo che il cliente legge davvero. */
const VISIBLE_ATTRIBUTES = new Set([
  'placeholder',
  'aria-label',
  'aria-description',
  'aria-placeholder',
  'title',
  'alt',
])

/**
 * Gli operatori che non trasformano un valore: `a ?? b`, `a || b`, `a && b`.
 * Fuori da questi, un letterale dentro un'espressione binaria e' un confronto
 * (`country === 'IT'`), non un testo che il cliente legge.
 */
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

/**
 * La stringa e' l'argomento di una chiamata di traduzione? Si guarda il primo
 * antenato che possa decidere: una `CallExpression` (e allora conta il nome del
 * chiamato, cosi' `t.rich(...)` vale come `t(...)`) oppure il confine
 * dell'espressione JSX / dello statement.
 */
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

/**
 * Il valore finisce sotto gli occhi del cliente? Due soli posti contano:
 * un'espressione figlia di un elemento JSX (testo renderizzato) e un attributo
 * il cui valore e' letto da una persona. `className`, `style`, `href` no, e
 * nemmeno gli operandi di un confronto (`country === 'IT'`) o gli argomenti di
 * una funzione (`track('checkout_started')`, `alert(...)`).
 */
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
      // Solo i due rami sono valori; la condizione e' una verifica.
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

/** Testo letterale visibile al cliente e non tradotto, dentro un sorgente JSX. */
function findUntranslatedText(fileName: string, source: string): Violation[] {
  const sourceFile = parseSource(fileName, source)
  const violations: Violation[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim()
      // Un glifo solo (`✕`, `🔒`) non e' una parola da tradurre: non contiene lettere.
      if (hasLetter(text)) {
        violations.push({ line: lineOf(sourceFile, node), text, why: 'testo JSX scritto a mano' })
      }
      return
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text
      if (hasLetter(text) && isRenderedValue(node) && !isInsideTranslationCall(node)) {
        const why = ts.isNoSubstitutionTemplateLiteral(node) ? 'template letterale nel JSX' : 'stringa letterale nel JSX'
        violations.push({ line: lineOf(sourceFile, node), text, why })
      }
      return
    }

    if (ts.isTemplateExpression(node)) {
      // `Sconto ${percent}%`: la parte fissa della frase e' testo, le
      // sostituzioni no. Si guarda la testa e le span letterali.
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      const text = parts.join('').trim()
      if (hasLetter(text) && isRenderedValue(node) && !isInsideTranslationCall(node)) {
        violations.push({ line: lineOf(sourceFile, node), text, why: 'frase composta a mano nel JSX' })
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations.sort((a, b) => a.line - b.line)
}

interface TranslationKey {
  key: string
  line: number
}

/** Le chiavi passate a `t('...')` nella pagina: quelle che il runtime risolve. */
function collectTranslationKeys(fileName: string, source: string): TranslationKey[] {
  const sourceFile = parseSource(fileName, source)
  const keys: TranslationKey[] = []

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

/** Ogni letterale che finisce sotto gli occhi del cliente, tradotto o no. */
function collectRenderedLiterals(fileName: string, source: string): string[] {
  const sourceFile = parseSource(fileName, source)
  const literals: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      const text = node.text.trim()
      if (text) literals.push(text)
      return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (isRenderedValue(node)) literals.push(node.text)
      return
    }
    if (ts.isTemplateExpression(node)) {
      if (isRenderedValue(node)) {
        literals.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(''))
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return literals
}

function checkoutNamespace(locale: string): Record<string, unknown> {
  const file = path.join(process.cwd(), 'messages', `${locale}.json`)
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
  const namespace = parsed.checkout
  assert.ok(namespace && typeof namespace === 'object', `${locale}.json non ha il namespace checkout`)
  return namespace as Record<string, unknown>
}

/** Percorsi foglia, cosi' anche i sotto-namespace (`fields`, `countries`) contano. */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenKeys(child, prefix ? `${prefix}.${key}` : key),
    )
  }
  return [prefix]
}

function resolveKey(namespace: Record<string, unknown>, dotted: string): unknown {
  let current: unknown = namespace
  for (const part of dotted.split('.')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

test('il checkout non contiene testo visibile scritto a mano fuori da t(...)', () => {
  const source = fs.readFileSync(PAGE_FILE, 'utf8')
  const violations = findUntranslatedText(PAGE, source)
  const detail = violations.map((v) => `  ${PAGE}:${v.line} — ${v.why}: ${JSON.stringify(v.text)}`).join('\n')
  assert.equal(violations.length, 0, `stringhe non tradotte nel checkout:\n${detail}`)
})

test('la guardia riconosce il difetto che deve riconoscere', () => {
  // Se la guardia non sapesse vedere una frase scritta a mano, il verde del
  // test sopra non direbbe nulla. Si prova su un frammento che riproduce il
  // difetto vero, piu' i falsi positivi che non deve produrre.
  const broken = `
    export default function Page() {
      const t = useTranslations('checkout')
      return (
        <div>
          <p>Riepilogo ordine</p>
          <span>Spedizione</span>
          <span>{cond ? 'Gratuita' : 'Da quotare'}</span>
          <span>{\`Sconto \${percent}%\`}</span>
          <input placeholder="CODICE PROMO" />
          <button>{t('promoApply')}</button>
          <span className={clsx('text-sm')}>{t('labelFree')}</span>
          <span aria-hidden>🔒</span>
          <span>{t.rich('freeShippingAdd', { amount: '1,00', b: (c) => <b>{c}</b> })}</span>
        </div>
      )
    }
  `
  const violations = findUntranslatedText('broken.tsx', broken)
  const texts = violations.map((v) => v.text)
  for (const expected of ['Riepilogo ordine', 'Spedizione', 'Gratuita', 'Da quotare', 'CODICE PROMO']) {
    assert.ok(
      texts.includes(expected),
      `la guardia non ha visto ${JSON.stringify(expected)}: ${JSON.stringify(texts)}`,
    )
  }
  assert.ok(
    texts.some((text) => text.startsWith('Sconto')),
    `la guardia non ha visto la frase composta con percentuale: ${JSON.stringify(texts)}`,
  )
  // ...e non deve segnalare cio' che e' tradotto, cio' che non e' testo, i
  // confronti e i glifi: un guardiano che grida al lupo viene disattivato.
  for (const allowed of ['promoApply', 'labelFree', 'text-sm', 'freeShippingAdd', '🔒']) {
    assert.ok(!texts.includes(allowed), `falso positivo su ${JSON.stringify(allowed)}`)
  }
})

test('ogni chiave usata dalla pagina esiste in tutte e cinque le lingue', () => {
  const source = fs.readFileSync(PAGE_FILE, 'utf8')
  const keys = collectTranslationKeys(PAGE, source)
  assert.ok(keys.length >= 20, `la pagina dovrebbe usare il namespace checkout: trovate ${keys.length} chiavi`)

  for (const locale of LOCALES) {
    const namespace = checkoutNamespace(locale)
    for (const { key, line } of keys) {
      const value = resolveKey(namespace, key)
      assert.equal(typeof value, 'string', `${locale}.json non ha checkout.${key} (${PAGE}:${line})`)
      assert.ok(String(value).trim() !== '', `${locale}.json: checkout.${key} e' vuota (${PAGE}:${line})`)
    }
  }
})

test('il namespace checkout ha le stesse chiavi in tutte e cinque le lingue', () => {
  const reference = flattenKeys(checkoutNamespace('it')).sort()
  assert.ok(reference.length >= 40, `il namespace checkout dovrebbe essere popolato: ${reference.length} chiavi`)
  for (const locale of LOCALES) {
    assert.deepEqual(
      flattenKeys(checkoutNamespace(locale)).sort(),
      reference,
      `chiavi diverse in ${locale}.json (namespace checkout)`,
    )
  }
})

test('le frasi che portano un importo, un paese o una percentuale tengono il segnaposto in ogni lingua', () => {
  const placeholders: Record<string, string> = {
    // le tre stringhe che questo giro ha portato fuori dal JSX
    orderSummary: '',
    labelSubtotal: '',
    labelDiscount: '',
    labelTotalVatIncluded: '',
    promoCodePlaceholder: '',
    promoInvalidExpired: '',
    emailInvalidRecheck: '',
    phoneInvalid: '',
    securePaymentNote: '',
    freeShippingAdd: '{amount}',
    labelShipping: '{country}',
    labelDiscountPercent: '{percent}',
    postalCodeInvalidFor: '{country}',
  }
  for (const locale of LOCALES) {
    const namespace = checkoutNamespace(locale)
    for (const [key, placeholder] of Object.entries(placeholders)) {
      const value = resolveKey(namespace, key)
      assert.equal(typeof value, 'string', `${locale}.json non ha checkout.${key}`)
      if (placeholder) {
        assert.ok(String(value).includes(placeholder), `${locale}: manca ${placeholder} in checkout.${key}`)
      }
      // Nessun importo scritto a mano: se un numero compare in chiaro nella
      // frase, la soglia o il costo possono divergere dal codice.
      assert.ok(
        !/\d/.test(String(value)),
        `${locale}: checkout.${key} contiene un numero scritto a mano: ${JSON.stringify(value)}`,
      )
    }
  }
})

test('il riepilogo italiano dice le stesse parole che i clienti leggono oggi', () => {
  // Queste stringhe erano scritte a mano nel JSX: la traduzione non deve
  // cambiarne il testo, altrimenti il cliente italiano vede una modifica di
  // copy dentro una PR che doveva solo tradurre.
  const italian = checkoutNamespace('it')
  const expected: Record<string, string> = {
    orderSummary: 'Riepilogo ordine',
    labelSubtotal: 'Subtotale',
    labelShipping: 'Spedizione — {country}',
    labelFree: 'Gratuita',
    labelDiscount: 'Sconto',
    labelDiscountPercent: 'Sconto {percent}%',
    labelTotalVatIncluded: 'Totale IVA inc.',
    freeShippingAdd: 'Aggiungi <b>{amount}€</b> per la spedizione gratuita',
    promoCodePlaceholder: 'CODICE PROMO',
    promoApply: 'Applica',
    promoRemove: 'Rimuovi',
    promoInvalidExpired: 'Codice non valido o scaduto',
    securePaymentNote: 'Stripe · Pagamento sicuro · Dati crittografati',
    emailInvalidRecheck: 'Email non valida — ricontrolla',
    phoneInvalid: 'Numero di telefono non valido',
    postalCodeInvalidFor: 'Formato CAP non valido per {country}',
  }
  for (const [key, text] of Object.entries(expected)) {
    assert.equal(italian[key], text, `checkout.${key} in italiano non riproduce il testo che la pagina mostrava`)
  }
})

test('nessuna delle stringhe italiane fisse e\' rimasta nel JSX del checkout', () => {
  // La guardia AST sopra e' generale; questa e' la lista nominata del difetto
  // che la card descrive, cosi' un domani che qualcuno la reintroduca il
  // messaggio d'errore dice quale frase e' tornata. Si guardano solo i
  // letterali che il browser rende: le etichette passate a `track()` (analytics)
  // non sono testo per il cliente e restano come sono.
  const source = fs.readFileSync(PAGE_FILE, 'utf8')
  const rendered = collectRenderedLiterals(PAGE, source)
  const banned = [
    'Riepilogo ordine',
    'Subtotale',
    'Spedizione —',
    'Gratuita',
    'Sconto',
    'Totale IVA inc.',
    'Aggiungi',
    'per la spedizione gratuita',
    'CODICE PROMO',
    'Applica',
    'Rimuovi',
    'Codice non valido o scaduto',
    'Pagamento sicuro',
    'Numero di telefono non valido',
    'Email non valida',
    'Formato CAP non valido',
  ]
  const found = banned.filter((text) => rendered.some((literal) => literal.includes(text)))
  assert.deepEqual(found, [], `stringhe italiane fisse ancora rese dal JSX: ${JSON.stringify(found)}`)
})
