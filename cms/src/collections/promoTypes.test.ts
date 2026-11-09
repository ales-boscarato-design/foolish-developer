import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROMO_TYPES, PROMO_TYPE_LABELS, isPromoType } from './promoTypes'

// Questi test girano in CI con `npm run test` (step "CMS — test"). Servono come guardia
// di deriva: la lista dei tipi e' l'unica fonte, e gli enum PostgreSQL delle migration
// devono restare allineati, altrimenti una scrittura valida in app fallisce sul DB.

/** Ogni file di migration che tocca un enum, concatenato: la guardia guarda l'unione. */
function readMigrationsMentioning(marker: string): string {
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url))
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'))
  return files
    .map((name) => readFileSync(`${dir}${name}`, 'utf8'))
    .filter((source) => source.includes(marker))
    .join('\n')
}

test('isPromoType accepts exactly the supported types', () => {
  for (const type of PROMO_TYPES) {
    assert.equal(isPromoType(type), true, type)
    assert.equal(typeof PROMO_TYPE_LABELS[type], 'string')
    assert.ok(PROMO_TYPE_LABELS[type].length > 0, `etichetta mancante per ${type}`)
  }

  for (const rejected of [null, undefined, '', 'percent-tiered', 'PERCENT', 42, {}, []]) {
    assert.equal(isPromoType(rejected), false, JSON.stringify(rejected))
  }
})

test('the promo codes enum migrations cover every type', () => {
  const source = readMigrationsMentioning('enum_promo_codes_type')

  for (const type of PROMO_TYPES) {
    assert.ok(source.includes(`'${type}'`), `enum_promo_codes_type non contiene ${type}`)
  }
})

test('the order promo enum migration covers every type', () => {
  const orders = readMigrationsMentioning('enum_orders_promo_type')
  for (const type of PROMO_TYPES) {
    assert.ok(orders.includes(`'${type}'`), `enum_orders_promo_type non contiene ${type}`)
  }
})
