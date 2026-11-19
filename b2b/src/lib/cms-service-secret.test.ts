import assert from 'node:assert/strict'
import test from 'node:test'
import { cmsServiceSecret } from './cms-service-secret'

function clear(): void {
  delete process.env.B2B_API_SECRET
  delete process.env.PAYLOAD_API_SECRET
}

test('preferisce B2B_API_SECRET al legacy PAYLOAD_API_SECRET', () => {
  clear()
  process.env.PAYLOAD_API_SECRET = 'legacy-value'
  process.env.B2B_API_SECRET = 'new-value'
  try {
    assert.equal(cmsServiceSecret(), 'new-value')
  } finally {
    clear()
  }
})

test('usa il legacy solo come fallback durante la transizione', () => {
  clear()
  process.env.PAYLOAD_API_SECRET = 'legacy-value'
  try {
    assert.equal(cmsServiceSecret(), 'legacy-value')
  } finally {
    clear()
  }
})

test('senza nessuna delle due variabili restituisce stringa vuota', () => {
  clear()
  assert.equal(cmsServiceSecret(), '')
})
