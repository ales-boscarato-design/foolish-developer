import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import { routing } from '../i18n/routing'

/**
 * La scheda prodotto racconta al cliente tre cose che nessun test di tipo vede:
 * quando arriva il pacco, quanto costa spedirlo e com'e' fatto il pezzo. Sono
 * frasi, e come tutte le frasi possono divergere da una lingua all'altra senza
 * che niente fallisca: `next-intl` mostra la chiave grezza (o ricade
 * sull'italiano) solo nella lingua che nessuno ha guardato.
 *
 * Questo file fissa il contratto delle chiavi nuove di `product`:
 *
 *  1. le stesse foglie in it, en, fr, es, de — una chiave aggiunta a una lingua
 *     e dimenticata nelle altre e' il difetto che nessun typecheck vede;
 *  2. le chiavi ci sono e non sono vuote;
 *  3. gli stessi segnaposto (`{days}`, `{cost}`, `{threshold}`) in ogni lingua:
 *     un `{days}` perso in traduzione stampa un numero che non compare;
 *  4. le quattro lingue straniere non portano italiano dentro: una frase
 *     rimasta in italiano e' peggio di una frase mancante, perche' sembra
 *     tradotta;
 *  5. i soldi restano segnaposto con il simbolo in coda (`{cost}€`), mai una
 *     cifra scritta a mano: la convenzione e' quella di `money.test.ts`;
 *  6. le due frasi doganali (`extraEuDap` e `extraEuDdp`) esistono entrambe,
 *     sono diverse e non si contaminano: una dice che i dazi li paga il
 *     destinatario, l'altra che sono inclusi, mai tutte e due in una frase;
 *  7. le quattro verita' tecniche del materiale (stencil, discromie, spessore,
 *     traslucenza) restano tutte e cinque presenti, con lo spessore identico in
 *     ogni lingua;
 *  8. gli stati del carrello (`available`, `onOrder`) esistono ovunque.
 *
 * La scelta fra `extraEuDap` e `extraEuDdp` spetta alla scheda prodotto e deve
 * passare dall'interruttore condiviso col prezzo: non si mostrano mai insieme.
 */

const LOCALES = ['it', 'en', 'de', 'fr', 'es'] as const
type Locale = (typeof LOCALES)[number]

/** Le locale che non devono contenere italiano. */
const NON_ITALIAN: readonly Locale[] = ['en', 'de', 'fr', 'es']

/** Le chiavi che questa card aggiunge al namespace `product`. */
const NEW_KEYS = [
  'delivery.bandEu',
  'delivery.bandExtraEu',
  'delivery.productionExtra',
  'shippingCost.title',
  'shippingCost.italy',
  'shippingCost.eu',
  'shippingCost.extraEuDdp',
  'shippingCost.extraEuDap',
  'tech.title',
  'tech.stencil',
  'tech.discromie',
  'tech.thickness',
  'tech.translucency',
  'available',
  'onOrder',
] as const

/** Le quattro verita' tecniche, piu' il titolo che le introduce. */
const TECH_KEYS = ['title', 'stencil', 'discromie', 'thickness', 'translucency'] as const

/**
 * Parole che restano italiane solo se la traduzione non e' stata fatta. Sono
 * scelte per non colpire le lingue vere: `gratis` in spagnolo e `Italia` in
 * spagnolo sono corretti e non sono in questa lista.
 */
const ITALIAN_WORDS = [
  'giorni lavorativi',
  'spedizione',
  'dazi',
  'carrello',
  'ordinazione',
  'spessore',
  'gratuita',
  'sopra',
  'Italia e UE',
]

/**
 * Le due formule doganali, per lingua: `recipient` dice che i dazi li paga chi
 * riceve il pacco, `included` che sono gia' dentro il costo di spedizione.
 * Devono comparire una per frase, mai insieme.
 */
const CUSTOMS_TOKENS: Record<Locale, { recipient: string; included: string }> = {
  it: { recipient: 'a carico del destinatario', included: 'inclusi nel costo di spedizione' },
  en: { recipient: 'paid by the recipient', included: 'included in the shipping cost' },
  de: { recipient: 'trägt der Empfänger', included: 'im Versandpreis enthalten' },
  fr: { recipient: 'à la charge du destinataire', included: 'inclus dans les frais de port' },
  es: { recipient: 'a cargo del destinatario', included: 'incluidos en el coste del envío' },
}

/** Parole che non appartengono al racconto del materiale. */
const REVIEW_WORDS = ['recension', 'review', 'testimonian', 'testimonial', 'Bewertung', 'avis client', 'reseña']

function messagesFile(locale: Locale): string {
  return path.join(process.cwd(), 'messages', `${locale}.json`)
}

function productNamespace(locale: Locale): Record<string, unknown> {
  const parsed = JSON.parse(fs.readFileSync(messagesFile(locale), 'utf8')) as { product?: unknown }
  const product = parsed.product
  assert.ok(
    product !== null && typeof product === 'object' && !Array.isArray(product),
    `${locale}.json non ha il namespace \`product\``,
  )
  return product as Record<string, unknown>
}

/** Percorsi foglia: i sotto-namespace (`delivery`, `tech`, ...) contano per esteso. */
function flattenKeys(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenKeys(child, prefix ? `${prefix}.${key}` : key),
    )
  }
  return [prefix]
}

function flattenValues(value: unknown, prefix = '', out = new Map<string, string>()): Map<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenValues(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else if (typeof value === 'string') {
    out.set(prefix, value)
  }
  return out
}

function resolveKey(namespace: Record<string, unknown>, dotted: string): unknown {
  let current: unknown = namespace
  for (const part of dotted.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/** I segnaposto come insieme: l'ordine nella frase non conta, la presenza si'. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
}

test('le chiavi foglia di product sono identiche nelle cinque lingue', () => {
  const reference = flattenKeys(productNamespace('it')).sort()
  assert.ok(reference.length >= NEW_KEYS.length, `il namespace product dovrebbe essere popolato: ${reference.length} chiavi`)

  const problems: string[] = []
  for (const locale of LOCALES) {
    const keys = flattenKeys(productNamespace(locale)).sort()
    const missing = reference.filter((key) => !keys.includes(key))
    const extra = keys.filter((key) => !reference.includes(key))
    if (missing.length > 0) problems.push(`${locale}.json manca: ${missing.join(', ')}`)
    if (extra.length > 0) problems.push(`${locale}.json ha in piu': ${extra.join(', ')}`)
  }
  assert.deepEqual(problems, [], `chiavi di product diverse fra le lingue:\n${problems.join('\n')}`)
})

test('le chiavi nuove esistono e non sono vuote in tutte e cinque le lingue', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const product = productNamespace(locale)
    for (const key of NEW_KEYS) {
      const value = resolveKey(product, key)
      if (typeof value !== 'string') problems.push(`${locale}: product.${key} assente o non stringa`)
      else if (value.trim() === '') problems.push(`${locale}: product.${key} e' vuota`)
    }
  }
  assert.deepEqual(problems, [], `chiavi nuove mancanti o vuote:\n${problems.join('\n')}`)
})

test('ogni chiave di product tiene gli stessi segnaposto in tutte le lingue', () => {
  const reference = flattenValues(productNamespace('it'))
  const problems: string[] = []
  for (const locale of NON_ITALIAN) {
    const translated = flattenValues(productNamespace(locale))
    for (const [key, italian] of reference) {
      const value = translated.get(key)
      if (value === undefined) {
        problems.push(`${locale}: product.${key} assente`)
        continue
      }
      const expected = placeholders(italian)
      const actual = placeholders(value)
      if (expected.join(',') !== actual.join(',')) {
        problems.push(
          `${locale}: product.${key} ha i segnaposto [${actual.join(', ')}] invece di [${expected.join(', ')}] — «${value}»`,
        )
      }
    }
  }
  assert.deepEqual(problems, [], `segnaposto diversi fra le lingue:\n${problems.join('\n')}`)
})

test('le chiavi nuove non restano in italiano fuori dall italiano', () => {
  const italian = flattenValues(productNamespace('it'))
  const problems: string[] = []
  for (const locale of NON_ITALIAN) {
    const translated = flattenValues(productNamespace(locale))
    for (const key of NEW_KEYS) {
      const value = translated.get(key)
      const italianValue = italian.get(key)
      if (value === undefined) {
        problems.push(`${locale}: product.${key} assente`)
        continue
      }
      if (value === italianValue) {
        problems.push(`${locale}: product.${key} ha lo stesso testo dell'italiano — «${value}»`)
      }
      const lowered = value.toLowerCase()
      for (const word of ITALIAN_WORDS) {
        if (lowered.includes(word.toLowerCase())) {
          problems.push(`${locale}: product.${key} contiene la parola italiana «${word}» — «${value}»`)
        }
      }
    }
  }
  assert.deepEqual(problems, [], `italiano rimasto nelle traduzioni:\n${problems.join('\n')}`)
})

test('i costi di spedizione sono segnaposto con il simbolo in coda, mai importi scritti a mano', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const product = productNamespace(locale)
    for (const key of ['shippingCost.italy', 'shippingCost.eu']) {
      const value = resolveKey(product, key)
      if (typeof value !== 'string') {
        problems.push(`${locale}: product.${key} assente`)
        continue
      }
      if (!value.includes('{cost}€')) problems.push(`${locale}: product.${key} non scrive {cost}€ — «${value}»`)
      if (!value.includes('{threshold}€')) {
        problems.push(`${locale}: product.${key} non scrive {threshold}€ — «${value}»`)
      }
      if (/\d/.test(value)) problems.push(`${locale}: product.${key} contiene una cifra scritta a mano — «${value}»`)
      if (value.includes('€{')) problems.push(`${locale}: product.${key} mette il simbolo in testa — «${value}»`)
    }
  }
  assert.deepEqual(problems, [], `costi di spedizione fuori convenzione:\n${problems.join('\n')}`)
})

test('le due frasi doganali esistono, sono diverse e non si contaminano', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const product = productNamespace(locale)
    const ddp = resolveKey(product, 'shippingCost.extraEuDdp')
    const dap = resolveKey(product, 'shippingCost.extraEuDap')
    if (typeof ddp !== 'string' || ddp.trim() === '') {
      problems.push(`${locale}: product.shippingCost.extraEuDdp assente o vuota`)
    }
    if (typeof dap !== 'string' || dap.trim() === '') {
      problems.push(`${locale}: product.shippingCost.extraEuDap assente o vuota`)
    }
    if (typeof ddp !== 'string' || typeof dap !== 'string') continue

    if (ddp === dap) {
      problems.push(`${locale}: extraEuDdp ed extraEuDap hanno lo stesso testo — «${ddp}»`)
      continue
    }

    const { recipient, included } = CUSTOMS_TOKENS[locale]
    const loweredDdp = ddp.toLowerCase()
    const loweredDap = dap.toLowerCase()
    const hasRecipientDdp = loweredDdp.includes(recipient.toLowerCase())
    const hasIncludedDdp = loweredDdp.includes(included.toLowerCase())
    const hasRecipientDap = loweredDap.includes(recipient.toLowerCase())
    const hasIncludedDap = loweredDap.includes(included.toLowerCase())

    if (!hasIncludedDdp) {
      problems.push(`${locale}: extraEuDdp non dice «${included}» — «${ddp}»`)
    }
    if (hasRecipientDdp) {
      problems.push(`${locale}: extraEuDdp contiene la formula del destinatario «${recipient}» — «${ddp}»`)
    }
    if (!hasRecipientDap) {
      problems.push(`${locale}: extraEuDap non dice «${recipient}» — «${dap}»`)
    }
    if (hasIncludedDap) {
      problems.push(`${locale}: extraEuDap contiene la formula di inclusione «${included}» — «${dap}»`)
    }
    if (hasRecipientDdp && hasIncludedDdp) {
      problems.push(`${locale}: extraEuDdp dice dazi inclusi e a carico del destinatario insieme — «${ddp}»`)
    }
    if (hasRecipientDap && hasIncludedDap) {
      problems.push(`${locale}: extraEuDap dice dazi inclusi e a carico del destinatario insieme — «${dap}»`)
    }
  }
  assert.deepEqual(problems, [], `frasi doganali ambigue:\n${problems.join('\n')}`)
})

test('la chiave generica extraEu non esiste piu in nessuna lingua', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const shippingCost = resolveKey(productNamespace(locale), 'shippingCost')
    if (shippingCost === null || typeof shippingCost !== 'object' || Array.isArray(shippingCost)) {
      problems.push(`${locale}: product.shippingCost non e' un oggetto`)
      continue
    }
    if (Object.prototype.hasOwnProperty.call(shippingCost, 'extraEu')) {
      problems.push(`${locale}: product.shippingCost ha ancora la chiave generica extraEu`)
    }
  }
  assert.deepEqual(problems, [], `chiave generica extraEu ancora presente:\n${problems.join('\n')}`)
})

test('le quattro verita tecniche restano tutte e cinque, con lo stesso spessore', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const tech = resolveKey(productNamespace(locale), 'tech')
    if (tech === null || typeof tech !== 'object' || Array.isArray(tech)) {
      problems.push(`${locale}: product.tech non e' un oggetto`)
      continue
    }
    const keys = Object.keys(tech as Record<string, unknown>).sort()
    const expected = [...TECH_KEYS].sort()
    if (keys.join(',') !== expected.join(',')) {
      problems.push(`${locale}: product.tech ha [${keys.join(', ')}] invece di [${expected.join(', ')}]`)
    }
    const thickness = (tech as Record<string, unknown>).thickness
    if (typeof thickness !== 'string' || !thickness.includes('4–8 mm')) {
      problems.push(`${locale}: product.tech.thickness non dice 4–8 mm — «${String(thickness)}»`)
    }
    for (const [key, value] of Object.entries(tech as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        problems.push(`${locale}: product.tech.${key} non e' una stringa`)
        continue
      }
      const lowered = value.toLowerCase()
      for (const word of REVIEW_WORDS) {
        if (lowered.includes(word.toLowerCase())) {
          problems.push(`${locale}: product.tech.${key} parla di recensioni («${word}») — «${value}»`)
        }
      }
    }
  }
  assert.deepEqual(problems, [], `verita' tecniche incomplete:\n${problems.join('\n')}`)
})

test('gli stati del carrello sono tradotti in tutte le lingue', () => {
  const problems: string[] = []
  for (const locale of LOCALES) {
    const product = productNamespace(locale)
    for (const key of ['available', 'onOrder']) {
      const value = product[key]
      if (typeof value !== 'string' || value.trim() === '') problems.push(`${locale}: product.${key} assente o vuota`)
    }
  }
  assert.deepEqual(problems, [], `stati del carrello mancanti:\n${problems.join('\n')}`)
})

test('le cinque lingue del test sono quelle pubblicate da next-intl', () => {
  // Una lingua aggiunta al negozio senza entrare qui resterebbe senza scheda
  // prodotto tradotta, e nessuno dei test sopra la guarderebbe.
  assert.deepEqual([...LOCALES].sort(), [...routing.locales].sort())
})
