import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Orders shipping schema keeps structured Italian recipient fields', () => {
  const source = readFileSync(new URL('./Orders.ts', import.meta.url), 'utf8')
  const start = source.indexOf("name: 'shippingAddress'")
  const end = source.indexOf("\n          ],\n        },", start)
  const shippingAddress = source.slice(start, end)
  assert.ok(start >= 0 && end > start, 'shippingAddress group is missing')

  for (const field of ['firstName', 'lastName', 'province']) {
    assert.match(shippingAddress, new RegExp(`name: '${field}'`), `shippingAddress.${field} is missing`)
  }
  assert.match(source, /const addressText = addr[\s\S]*addr\.province/, 'operational shipping address omits province')
})
