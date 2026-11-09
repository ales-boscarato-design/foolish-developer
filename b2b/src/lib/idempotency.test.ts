import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  IDEMPOTENCY_STORAGE_KEY,
  cartFingerprint,
  getOrCreateIdempotencyKey,
  type IdempotencyStorage,
} from './idempotency'

const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/

interface Item {
  variantSku: string
  qty: number
  unitPrice: number
}

const ITEMS: Item[] = [
  { variantSku: 'ST-14', qty: 2, unitPrice: 14.99 },
  { variantSku: 'KIT-5', qty: 1, unitPrice: 5 },
]

const FORM = { shippingCountry: 'IT', email: 'Acquirente@Example.test' }

function memoryStorage(initial?: string): IdempotencyStorage & { value: string | null; writes: number } {
  const store = {
    value: initial ?? null,
    writes: 0,
    getItem(_key: string): string | null {
      return store.value
    },
    setItem(_key: string, value: string): void {
      store.value = value
      store.writes += 1
    },
  }
  return store
}

test('stessa fingerprint -> stessa chiave, senza riscrivere lo storage', () => {
  const storage = memoryStorage()
  let generated = 0
  const generate = () => `generated-key-${++generated}-000000`

  const first = getOrCreateIdempotencyKey(cartFingerprint(ITEMS, FORM), storage, generate)
  const second = getOrCreateIdempotencyKey(cartFingerprint(ITEMS, FORM), storage, generate)

  assert.equal(first, second)
  assert.equal(generated, 1)
  assert.equal(storage.writes, 1)
  assert.deepEqual(JSON.parse(storage.value ?? '{}'), {
    fingerprint: cartFingerprint(ITEMS, FORM),
    key: first,
  })
  assert.equal(JSON.parse(storage.value ?? '{}').key, first)
})

test('storage vuoto: genera e salva una chiave', () => {
  const storage = memoryStorage()
  const key = getOrCreateIdempotencyKey('fp', storage, () => 'generated-key-0000001')

  assert.equal(key, 'generated-key-0000001')
  assert.equal(storage.writes, 1)
  assert.equal(storage.value, JSON.stringify({ fingerprint: 'fp', key }))
})

test('cartFingerprint e ordinata per SKU: l’ordine del carrello non conta', () => {
  const reversed = [...ITEMS].reverse()
  assert.equal(cartFingerprint(ITEMS, FORM), cartFingerprint(reversed, FORM))
})

test('cartFingerprint cambia se cambia la quantita', () => {
  const changed = [{ ...ITEMS[0], qty: 3 }, ITEMS[1]]
  assert.notEqual(cartFingerprint(ITEMS, FORM), cartFingerprint(changed, FORM))
})

test('cartFingerprint cambia se cambia il prezzo', () => {
  const changed = [{ ...ITEMS[0], unitPrice: 15.99 }, ITEMS[1]]
  assert.notEqual(cartFingerprint(ITEMS, FORM), cartFingerprint(changed, FORM))
})

test('cartFingerprint cambia se cambia il paese', () => {
  assert.notEqual(
    cartFingerprint(ITEMS, FORM),
    cartFingerprint(ITEMS, { ...FORM, shippingCountry: 'FR' }),
  )
})

test('cartFingerprint cambia se cambia l’email (anche solo per maiuscole)', () => {
  assert.notEqual(
    cartFingerprint(ITEMS, FORM),
    cartFingerprint(ITEMS, { ...FORM, email: 'altro@example.test' }),
  )
})

test('cartFingerprint non calcola un totale in float: due righe non collidono con una', () => {
  const one = [{ variantSku: 'A', qty: 1, unitPrice: 0.1 }]
  const two = [{ variantSku: 'A', qty: 1, unitPrice: 0.1 }, { variantSku: 'B', qty: 1, unitPrice: 0.1 }]
  assert.notEqual(cartFingerprint(one, FORM), cartFingerprint(two, FORM))
})

// --- B1: la fingerprint copre tutti i campi del documento ------------------

const DOCUMENT_FORM = {
  email: 'Acquirente@Example.test',
  businessName: 'Studio Test Srl',
  vatNumber: 'IT12345678901',
  sdiCode: '0000000',
  billingAddress1: 'Via Fattura 1',
  billingCity: 'Torino',
  billingPostalCode: '10100',
  billingCountry: 'IT',
  shippingName: 'Mario Test',
  shippingAddress1: 'Via Spedizione 1',
  shippingCity: 'Torino',
  shippingPostalCode: '10100',
  shippingCountry: 'IT',
  notes: 'Consegna al piano',
}

const DOCUMENT_FIELD_CHANGES: Array<[keyof typeof DOCUMENT_FORM, string]> = [
  ['email', 'altro@example.test'],
  ['businessName', 'Studio Diverso Srl'],
  ['vatNumber', 'IT99999999999'],
  ['sdiCode', '1234567'],
  ['billingAddress1', 'Via Fattura 2'],
  ['billingCity', 'Milano'],
  ['billingPostalCode', '20100'],
  ['billingCountry', 'FR'],
  ['shippingName', 'Anna Test'],
  ['shippingAddress1', 'Via Spedizione 2'],
  ['shippingCity', 'Milano'],
  ['shippingPostalCode', '20100'],
  ['shippingCountry', 'FR'],
  ['notes', 'Altra nota'],
]

for (const [field, changed] of DOCUMENT_FIELD_CHANGES) {
  test(`B1.1 cartFingerprint cambia quando cambia ${field}`, () => {
    assert.notEqual(
      cartFingerprint(ITEMS, DOCUMENT_FORM),
      cartFingerprint(ITEMS, { ...DOCUMENT_FORM, [field]: changed }),
      `${field} non entra nella fingerprint`,
    )
  })
}

test('B1.1 canonicalizzazione: trim, email minuscola, P.IVA e paesi maiuscoli', () => {
  const variant = {
    ...DOCUMENT_FORM,
    email: '  ACQUIRENTE@EXAMPLE.TEST  ',
    businessName: '  Studio Test Srl  ',
    vatNumber: '  it12345678901 ',
    sdiCode: ' 0000000 ',
    billingAddress1: '  Via Fattura 1 ',
    billingCity: ' Torino ',
    billingPostalCode: ' 10100 ',
    billingCountry: ' it ',
    shippingName: ' Mario Test ',
    shippingAddress1: '  Via Spedizione 1 ',
    shippingCity: ' Torino ',
    shippingPostalCode: ' 10100 ',
    shippingCountry: ' it ',
    notes: '  Consegna al piano  ',
  }

  assert.equal(cartFingerprint(ITEMS, DOCUMENT_FORM), cartFingerprint(ITEMS, variant))
})

test('B1.1 campi assenti, undefined e null valgono tutti stringa vuota', () => {
  const explicitEmpty = Object.fromEntries(
    Object.keys(DOCUMENT_FORM).map((field) => [field, field === 'vatNumber' ? null : undefined]),
  )
  assert.equal(cartFingerprint(ITEMS, {}), cartFingerprint(ITEMS, explicitEmpty))
})

test('una chiave generata da crypto.randomUUID e conforme alla regex della rotta', () => {
  const storage = memoryStorage()
  const key = getOrCreateIdempotencyKey('fp', storage)

  assert.match(key, KEY_RE)
  assert.ok(key.length >= 16 && key.length <= 128)
})

test('una chiave diversa viene generata quando la fingerprint cambia', () => {
  const storage = memoryStorage()
  const first = getOrCreateIdempotencyKey('fp-1', storage, () => 'generated-key-0000001')
  const second = getOrCreateIdempotencyKey('fp-2', storage, () => 'generated-key-0000002')

  assert.notEqual(first, second)
  assert.equal(JSON.parse(storage.value ?? '{}').fingerprint, 'fp-2')
  assert.equal(JSON.parse(storage.value ?? '{}').key, second)
})

test('storage corrotto: genera una chiave nuova invece di propagare l’errore', () => {
  const storage = memoryStorage('{non json')
  const key = getOrCreateIdempotencyKey('fp', storage, () => 'generated-key-0000001')

  assert.equal(key, 'generated-key-0000001')
  assert.equal(IDEMPOTENCY_STORAGE_KEY, 'b2b_checkout_idem')
})

// --- parita' delle chiavi del namespace Checkout ---------------------------

const LOCALES = ['it', 'en', 'de', 'fr', 'es'] as const

function checkoutKeys(locale: string): string[] {
  const url = new URL(`../../messages/${locale}.json`, import.meta.url)
  const parsed = JSON.parse(readFileSync(url, 'utf8')) as { Checkout?: Record<string, unknown> }
  return Object.keys(parsed.Checkout ?? {}).sort()
}

test('namespace Checkout: stesse chiavi in it, en, de, fr, es', () => {
  const reference = checkoutKeys('it')
  assert.ok(reference.length > 0, 'il namespace Checkout non deve essere vuoto')
  for (const locale of LOCALES) {
    assert.deepEqual(checkoutKeys(locale), reference, `chiavi Checkout divergenti in ${locale}.json`)
  }
})

test('namespace Checkout: le chiavi degli errori di idempotenza esistono in tutte le lingue', () => {
  for (const locale of LOCALES) {
    const keys = checkoutKeys(locale)
    assert.ok(keys.includes('errorOrdineGiaPagato'), `errorOrdineGiaPagato manca in ${locale}.json`)
    assert.ok(keys.includes('errorOrdineNonCoerente'), `errorOrdineNonCoerente manca in ${locale}.json`)
  }
})
