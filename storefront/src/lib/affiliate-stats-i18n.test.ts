import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

/**
 * The affiliate statistics page is the one page of the shop read by people who
 * are not customers and not Italian speakers. A key added in one message file
 * and forgotten in another would not fail the build: the page would simply show
 * the raw key, or throw at render time, in one language only. This pins the
 * parity of the namespace across every published locale.
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
