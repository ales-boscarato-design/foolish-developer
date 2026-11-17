import assert from 'node:assert/strict'
import test from 'node:test'
import { adminSecret } from './admin-secret'

function clear(): void {
  delete process.env.FOOLISH_ADMIN_SECRET
  delete process.env.STOREFRONT_API_SECRET
  delete process.env.PAYLOAD_API_SECRET
}

test('preferisce FOOLISH_ADMIN_SECRET', () => {
  clear()
  process.env.PAYLOAD_API_SECRET = 'legacy-value'
  process.env.STOREFRONT_API_SECRET = 'storefront-value'
  process.env.FOOLISH_ADMIN_SECRET = 'admin-value'
  try {
    assert.equal(adminSecret(), 'admin-value')
  } finally {
    clear()
  }
})

test('poi STOREFRONT_API_SECRET', () => {
  clear()
  process.env.PAYLOAD_API_SECRET = 'legacy-value'
  process.env.STOREFRONT_API_SECRET = 'storefront-value'
  try {
    assert.equal(adminSecret(), 'storefront-value')
  } finally {
    clear()
  }
})

test('poi il legacy PAYLOAD_API_SECRET', () => {
  clear()
  process.env.PAYLOAD_API_SECRET = 'legacy-value'
  try {
    assert.equal(adminSecret(), 'legacy-value')
  } finally {
    clear()
  }
})

test('senza nessuna variabile restituisce stringa vuota', () => {
  clear()
  assert.equal(adminSecret(), '')
})
