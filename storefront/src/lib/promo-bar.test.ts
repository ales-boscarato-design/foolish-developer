import assert from 'node:assert/strict'
import test from 'node:test'
import { isPromoBarActive } from './promo-bar'

test('Black Friday window excludes times before its start and after its end', () => {
  assert.equal(isPromoBarActive(new Date('2026-11-26T23:59:59+01:00')), false)
  assert.equal(isPromoBarActive(new Date('2026-11-26T23:59:59.999+01:00')), false)
  assert.equal(isPromoBarActive(new Date('2026-11-27T00:00:00.001+01:00')), true)
  assert.equal(isPromoBarActive(new Date('2026-11-30T23:59:59.999+01:00')), true)
  assert.equal(isPromoBarActive(new Date('2026-12-01T00:00:00+01:00')), false)
})

test('window endpoints and invalid dates follow the configured cutoff', () => {
  assert.equal(isPromoBarActive(new Date('2026-11-27T00:00:00+01:00')), true)
  assert.equal(isPromoBarActive(new Date('2026-11-30T23:59:59.999+01:00')), true)
  assert.equal(isPromoBarActive(new Date(Number.NaN)), false)
})
