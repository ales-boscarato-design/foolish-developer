/**
 * Test dei parametri e delle decisioni della PaymentIntent B2B, con un client
 * Stripe finto. Nessuna rete, nessun SDK vero, nessuna chiave.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createOrderPaymentIntent,
  ensureOrderPaymentIntent,
  type StripeIntentDeps,
  type StripeIntentParams,
  type StripePaymentIntent,
} from './stripe-intents'

interface Call {
  params: unknown
  opts: unknown
}

interface RetrieveCall {
  id: string
  params: unknown
}

interface FakeOptions {
  existing?: StripePaymentIntent
  createError?: Error
  retrieveError?: Error
  retrieves?: RetrieveCall[]
}

function fakeDeps(
  calls: Call[],
  clientSecret: string | null = 'pi_test_secret',
  options: FakeOptions = {},
): StripeIntentDeps {
  let created = 0
  return {
    paymentIntents: {
      async create(params: StripeIntentParams, opts) {
        calls.push({ params, opts })
        if (options.createError) throw options.createError
        created += 1
        return { id: `pi_created_${created}`, client_secret: clientSecret }
      },
      async retrieve(id, params) {
        options.retrieves?.push({ id, params })
        if (options.retrieveError) throw options.retrieveError
        return options.existing ?? {
          id,
          status: 'requires_payment_method',
          client_secret: 'pi_existing_secret',
        }
      },
    },
  }
}

const ARGS = {
  amountCents: 11992,
  orderId: 1001,
  orderNumber: 'B2B-2608-ABCD',
  resellerEmail: 'acquirente@example.test',
}

// --- parametri invariati ----------------------------------------------------

test('la PaymentIntent porta importo, valuta, metadata e chiave di idempotenza', async () => {
  const calls: Call[] = []
  const result = await createOrderPaymentIntent(ARGS, fakeDeps(calls))

  assert.deepEqual(calls, [{
    params: {
      amount: 11992,
      currency: 'eur',
      metadata: {
        orderId: '1001',
        orderNumber: 'B2B-2608-ABCD',
        resellerEmail: 'acquirente@example.test',
      },
      automatic_payment_methods: { enabled: true },
    },
    opts: { idempotencyKey: 'B2B-2608-ABCD' },
  }])
  assert.deepEqual(result, { client_secret: 'pi_test_secret' })
})

test('orderId stringa viene serializzato nei metadata', async () => {
  const calls: Call[] = []
  await createOrderPaymentIntent({
    amountCents: 2264,
    orderId: 'ord_42',
    orderNumber: 'B2B-2608-EFGH',
    resellerEmail: 'x@example.test',
  }, fakeDeps(calls))
  const params = calls[0].params as { metadata: Record<string, string> }
  assert.equal(params.metadata.orderId, 'ord_42')
})

test('client_secret nullo passa invariato alla rotta', async () => {
  const result = await createOrderPaymentIntent({
    amountCents: 2264,
    orderId: 7,
    orderNumber: 'B2B-2608-IJKL',
    resellerEmail: 'x@example.test',
  }, fakeDeps([], null))
  assert.deepEqual(result, { client_secret: null })
})

// --- ensure: riusa o crea ---------------------------------------------------

test('ensure senza id esistente: crea una volta con la chiave orderNumber', async () => {
  const calls: Call[] = []
  const outcome = await ensureOrderPaymentIntent({ ...ARGS, existingIntentId: null }, fakeDeps(calls))

  assert.deepEqual(outcome, { kind: 'created', intentId: 'pi_created_1', clientSecret: 'pi_test_secret' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].opts, { idempotencyKey: 'B2B-2608-ABCD' })
})

for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action']) {
  test(`ensure con id e stato ${status}: riusa, zero create`, async () => {
    const calls: Call[] = []
    const retrieves: RetrieveCall[] = []
    const outcome = await ensureOrderPaymentIntent({ ...ARGS, existingIntentId: 'pi_esistente' }, fakeDeps(calls, undefined, {
      retrieves,
      existing: { id: 'pi_esistente', status, client_secret: 'pi_esistente_secret' },
    }))

    assert.deepEqual(outcome, {
      kind: 'reused',
      intentId: 'pi_esistente',
      clientSecret: 'pi_esistente_secret',
    })
    assert.equal(calls.length, 0, 'nessuna nuova PaymentIntent')
    assert.deepEqual(retrieves, [{ id: 'pi_esistente', params: { expand: ['latest_charge'] } }])
  })
}

for (const status of ['processing', 'requires_capture', 'succeeded', 'stato_futuro_sconosciuto']) {
  test(`ensure con id e stato ${status}: already_paid, zero create`, async () => {
    const calls: Call[] = []
    const outcome = await ensureOrderPaymentIntent({ ...ARGS, existingIntentId: 'pi_esistente' }, fakeDeps(calls, undefined, {
      existing: { id: 'pi_esistente', status, client_secret: 'pi_esistente_secret' },
    }))

    assert.deepEqual(outcome, { kind: 'already_paid' })
    assert.equal(calls.length, 0, 'nessuna nuova PaymentIntent')
  })
}

test('ensure con intent annullata e nessun addebito: nuova intent con chiave per generazione', async () => {
  const calls: Call[] = []
  const outcome = await ensureOrderPaymentIntent({ ...ARGS, existingIntentId: 'pi_annullata' }, fakeDeps(calls, undefined, {
    existing: {
      id: 'pi_annullata',
      status: 'canceled',
      client_secret: 'pi_annullata_secret',
      latest_charge: { status: 'failed' },
    },
  }))

  assert.deepEqual(outcome, { kind: 'created', intentId: 'pi_created_1', clientSecret: 'pi_test_secret' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].opts, { idempotencyKey: 'B2B-2608-ABCD:after:pi_annullata' })
})

test('ensure con intent annullata ma latest_charge riuscito: already_paid, zero create', async () => {
  const calls: Call[] = []
  const outcome = await ensureOrderPaymentIntent({ ...ARGS, existingIntentId: 'pi_annullata' }, fakeDeps(calls, undefined, {
    existing: {
      id: 'pi_annullata',
      status: 'canceled',
      latest_charge: { status: 'succeeded' },
    },
  }))

  assert.deepEqual(outcome, { kind: 'already_paid' })
  assert.equal(calls.length, 0, 'nessuna nuova PaymentIntent')
})

test('ensure con intent annullata ma paid true: already_paid, zero create', async () => {
  const calls: Call[] = []
  const outcome = await ensureOrderPaymentIntent({ ...ARGS, existingIntentId: 'pi_annullata' }, fakeDeps(calls, undefined, {
    existing: { id: 'pi_annullata', status: 'canceled', paid: true },
  }))

  assert.deepEqual(outcome, { kind: 'already_paid' })
  assert.equal(calls.length, 0, 'nessuna nuova PaymentIntent')
})

test('ensure: errore di retrieve propaga, nessuna create di sicurezza', async () => {
  const calls: Call[] = []
  const deps = fakeDeps(calls, undefined, { retrieveError: new Error('stripe giu') })

  await assert.rejects(
    ensureOrderPaymentIntent({ ...ARGS, existingIntentId: 'pi_esistente' }, deps),
    /stripe giu/,
  )
  assert.equal(calls.length, 0, 'un retrieve fallito non crea una seconda intent')
})

test('ensure: errore di create propaga', async () => {
  const deps = fakeDeps([], undefined, { createError: new Error('timeout ambiguo') })

  await assert.rejects(
    ensureOrderPaymentIntent({ ...ARGS, existingIntentId: null }, deps),
    /timeout ambiguo/,
  )
})
