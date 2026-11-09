import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  formatOrderLineTotal,
  orderLineTotalCents,
} from './order-line-amount'

const DASH = '—'

describe('order-line-amount', () => {
  it('caso 1: il valore contabile vince sulla formula float (il difetto)', () => {
    const line = { unitPrice: 0.9999, quantity: 50, lineTotalCents: 5000 }

    assert.equal(orderLineTotalCents(line), 5000)
    assert.equal(formatOrderLineTotal(line), '50.00')

    // La formula precedente in Orders.ts: (i.unitPrice * i.quantity).toFixed(2).
    // Il test deve fallire se qualcuno la rimette al posto del valore contabile.
    const legacyDisplay = (line.unitPrice * line.quantity).toFixed(2)
    assert.equal(legacyDisplay, '49.99')
    assert.notEqual(legacyDisplay, formatOrderLineTotal(line))
    assert.notEqual(legacyDisplay, (orderLineTotalCents(line)! / 100).toFixed(2))
  })

  it('caso 2: B2B reale 8.125 x 50 = 406.25 EUR', () => {
    const line = { unitPrice: 8.125, quantity: 50, lineTotalCents: 40625 }

    assert.equal(orderLineTotalCents(line), 40625)
    assert.equal(formatOrderLineTotal(line), '406.25')
  })

  it('caso 3: retail storico senza lineTotalCents usa il fallback aritmetico', () => {
    const line = { unitPrice: 14.99, quantity: 3 }

    assert.equal(orderLineTotalCents(line), 4497)
    assert.equal(formatOrderLineTotal(line), '44.97')
  })

  it('caso 4: fallback a mezzo centesimo arrotonda ai centesimi', () => {
    const line = { unitPrice: 1.01, quantity: 50 }

    assert.equal(orderLineTotalCents(line), 5050)
    assert.equal(formatOrderLineTotal(line), '50.50')
  })

  it('caso 5: valori illeggibili non inventano un importo', () => {
    const unreadable: Array<Record<string, unknown>> = [
      {},
      { unitPrice: 'x', quantity: 2 },
      { unitPrice: 10, quantity: 0 },
      { unitPrice: 10, quantity: 2, lineTotalCents: -5 },
      { unitPrice: 10, quantity: 2, lineTotalCents: 1.5 },
      { unitPrice: 10, quantity: 2, lineTotalCents: '200' },
    ]

    for (const line of unreadable) {
      assert.equal(orderLineTotalCents(line), null, JSON.stringify(line))
      assert.equal(formatOrderLineTotal(line), DASH, JSON.stringify(line))
    }
  })

  it('caso 6: invariante B2B 50 x 10 con fascia 18.75%', () => {
    const unitPrice = 8.125
    const quantity = 50
    const shippingCents = 0
    const lineTotalCents = Math.round(unitPrice * quantity * 100)

    assert.equal(lineTotalCents, 40625)

    const line = { unitPrice, quantity, lineTotalCents }
    const shown = formatOrderLineTotal(line)
    assert.equal(shown, '406.25')
    assert.equal(shown, ((lineTotalCents + shippingCents) / 100).toFixed(2))
  })
})
