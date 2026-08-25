import assert from 'node:assert/strict'
import test from 'node:test'
import { getB2BOrderNumber } from './stripe-webhook'

test('recognizes only non-empty B2B order metadata', () => {
  assert.equal(getB2BOrderNumber({ orderNumber: 'B2B-1001' }), 'B2B-1001')
  assert.equal(getB2BOrderNumber({}), null)
  assert.equal(getB2BOrderNumber({ orderNumber: '   ' }), null)
  assert.equal(getB2BOrderNumber(null), null)
  assert.equal(getB2BOrderNumber(undefined), null)
})
