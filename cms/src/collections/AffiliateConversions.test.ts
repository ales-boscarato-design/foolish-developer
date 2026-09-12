import assert from 'node:assert/strict'
import test from 'node:test'
import type { PayloadRequest } from 'payload'
import { applyOrderAttribution, applyRefundTransition } from './AffiliateConversions'

function requestWithTransaction(body: unknown, execute: (calls: string[]) => Promise<{ rows: unknown[] }>, calls: string[]) {
  const tx = {
    execute: async () => execute(calls),
  }
  return {
    headers: new Headers({ 'x-storefront-secret': 'test-secret' }),
    json: async () => body,
    payload: {
      db: {
        drizzle: {
          transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
        },
      },
    },
  } as unknown as PayloadRequest
}

function requestForCurrentRow(current: Record<string, unknown>, calls: string[]) {
  return requestWithTransaction({
    stripePaymentIntentId: 'pi_refund_test',
    amountRefundedCents: 2_500,
    refundStatus: 'partial',
  }, async () => {
    calls.push('select')
    return { rows: [current] }
  }, calls)
}

test('storefront order attribution requests with a PaymentIntent are accepted', async () => {
  process.env.PAYLOAD_API_SECRET = 'test-secret'
  const calls: string[] = []
  let executeCount = 0
  const response = await applyOrderAttribution(requestWithTransaction({
    stripeSessionId: 'cs_affiliate_test',
    stripePaymentIntentId: 'pi_affiliate_test',
    orderNumber: 'ORDER-1',
    affiliatePromoCode: 'NESTOR',
    affiliateSlug: 'nestor',
    affiliateEligibleAmountCents: 10_000,
    affiliateCommissionRateBps: 1_500,
    affiliateCommissionCents: 1_500,
  }, async () => {
    executeCount += 1
    calls.push(executeCount === 1 ? 'lock' : 'order-update')
    return executeCount === 1
      ? {
        rows: [{
          id: 1,
          stripe_session_id: 'cs_affiliate_test',
          stripe_payment_intent_id: 'pi_affiliate_test',
          order_number: 'ORDER-1',
          affiliate_id: 11,
          promo_code_snapshot: 'NESTOR',
          affiliate_slug_snapshot: 'nestor',
          eligible_amount_cents: 10_000,
          commission_rate_bps: 1_500,
          commission_amount_cents: 1_500,
          currency: 'EUR',
          payment_status: 'paid',
          refund_status: 'none',
          amount_refunded_cents: 0,
        }],
      }
      : { rows: [{ id: 99 }] }
  }, calls))

  assert.deepEqual(await response.json(), { status: 'patched' })
  assert.deepEqual(calls, ['lock', 'order-update'])
})

test('refund transitions fail closed for cancelled and malformed current states', async () => {
  process.env.PAYLOAD_API_SECRET = 'test-secret'

  for (const paymentStatus of ['cancelled', 'paid'] as const) {
    const calls: string[] = []
    const current = {
      id: 1,
      stripe_payment_intent_id: 'pi_refund_test',
      order_number: 'ORDER-1',
      payment_status: paymentStatus,
      refund_status: paymentStatus === 'cancelled' ? 'none' : 'partial',
      amount_refunded_cents: paymentStatus === 'cancelled' ? 0 : 0,
    }

    await assert.rejects(
      applyRefundTransition(requestForCurrentRow(current, calls)),
      /Malformed affiliate conversion state/,
    )
    assert.deepEqual(calls, ['select'])
  }
})
