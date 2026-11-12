/**
 * Test del segnale «zona registrata ≠ zona della destinazione» al rinnovo.
 *
 * Perche' esiste: il rinnovo si prezza da `record.zone` e si spedisce a
 * `invoice.customer_shipping`. Se qualcuno cambia l'indirizzo a mano (supporto o
 * dashboard Stripe) il cliente paga la tariffa della zona vecchia a ogni ciclo,
 * e nulla lo segnala. Il test fissa le tre cose che contano:
 *
 *   - zone coerenti  -> NESSUN segnale (un avviso che parla sempre non si legge);
 *   - zone divergenti -> segnale con il delta di costo, che si ripete a ogni ciclo;
 *   - paese mancante  -> segnale `unknown`, senza crash e senza delta inventato.
 *
 * Ermetico: il modulo di rilevamento e' puro, il canale di consegna e' iniettato.
 * Nessuna rete, nessuna credenziale, nessuna scrittura su Stripe.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  buildRenewalZoneAlertPayload,
  detectRenewalZoneMismatch,
  resolveDestinationZone,
} from './subscription-renewal-zone'
import {
  RENEWAL_ZONE_ALERT_CHANNELS,
  RENEWAL_ZONE_HOOK,
  deliverRenewalZoneAlert,
  reportRenewalZoneMismatch,
  sendRenewalZoneAlertEmail,
  sendRenewalZoneAlertTelegram,
} from './subscription-renewal-zone-alert'

const SUBSCRIPTION_ID = 'sub_1QExampleRenewal'
const realFetch = globalThis.fetch

interface Recorded {
  alerts: ReturnType<typeof buildRenewalZoneAlertPayload>[]
  logs: string[]
  fetchCalls: number
}

async function run(
  params: Parameters<typeof detectRenewalZoneMismatch>[0],
): Promise<Recorded> {
  const recorded: Recorded = { alerts: [], logs: [], fetchCalls: 0 }
  globalThis.fetch = (async () => {
    recorded.fetchCalls += 1
    throw new Error('nessuna rete attesa nella segnalazione')
  }) as typeof fetch

  try {
    const mismatch = detectRenewalZoneMismatch(params)
    await reportRenewalZoneMismatch(mismatch, {
      notify: async (payload) => {
        recorded.alerts.push(payload)
      },
      logger: (line) => {
        recorded.logs.push(line)
      },
    })
    return recorded
  } finally {
    globalThis.fetch = realFetch
  }
}

test('zone coerenti: nessun alert, nessun rumore', async () => {
  const sameZone = await run({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'tattoo',
    cycle: 1,
    registeredZone: 'IT',
    destinationCountry: 'IT',
  })
  assert.deepEqual(sameZone.alerts, [])
  assert.deepEqual(sameZone.logs, [])
  assert.equal(sameZone.fetchCalls, 0)

  // Anche il caso «zona EU, destinazione in un altro paese UE» e' coerente:
  // la scala ha una sola tariffa per tutta la zona.
  const sameZoneOtherCountry = await run({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'pmu',
    cycle: 3,
    registeredZone: 'EU',
    destinationCountry: 'de',
  })
  assert.deepEqual(sameZoneOtherCountry.alerts, [])
  assert.deepEqual(sameZoneOtherCountry.logs, [])
})

test('CH registrato e destinazione italiana: alert con il delta di costo', async () => {
  // Chi si e' attivato con destinazione svizzera ha zona registrata `EU` (CH sta
  // in `EU_COUNTRIES`, la scala e' un prodotto), ma la zona di SPEDIZIONE di CH e'
  // `EXTRA_EU`: fuori dall'unione doganale. Questa divergenza e' un punto
  // commerciale aperto e noto nel codice (14,99 addebitati contro 41-44 di costo
  // sdoganato), e proprio per questo deve essere VISIBILE a ogni rinnovo invece
  // che silenziosa: la scala non ha una tariffa per EXTRA_EU, quindi il delta non
  // si inventa.
  const swissDestination = await run({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'tattoo',
    cycle: 1,
    registeredZone: 'EU',
    destinationCountry: 'CH',
  })
  assert.equal(swissDestination.alerts.length, 1)
  assert.equal(swissDestination.alerts[0].destinationZone, 'EXTRA_EU')
  assert.equal(swissDestination.alerts[0].reason, 'destination_outside_subscription_zones')
  assert.equal(swissDestination.alerts[0].shippingDelta, null)

  // Il caso con delta calcolabile: contratto registrato sulla scala `EU`,
  // indirizzo cambiato a mano su una destinazione italiana (zona `IT`).
  const moved = await run({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'tattoo',
    cycle: 1,
    registeredZone: 'EU',
    destinationCountry: 'IT',
  })

  assert.equal(moved.alerts.length, 1)
  const alert = moved.alerts[0]
  assert.equal(alert.event, 'subscription_renewal_zone_mismatch')
  assert.equal(alert.subscriptionId, SUBSCRIPTION_ID)
  assert.equal(alert.registeredZone, 'EU')
  assert.equal(alert.destinationZone, 'IT')
  assert.equal(alert.destinationCountry, 'IT')
  assert.equal(alert.reason, 'zone_changed')
  assert.equal(alert.registeredShipping, 14.99)
  assert.equal(alert.destinationShipping, 7.65)
  // 7,65 - 14,99: si stanno incassando 7,34 EUR piu' del dovuto, a ogni ciclo.
  assert.equal(alert.shippingDelta, -7.34)
  assert.equal(alert.totalDelta, -7.34)

  // Una riga di log strutturata, la stessa del payload: filtrabile per `event`.
  assert.equal(moved.logs.length, 1)
  assert.deepEqual(JSON.parse(moved.logs[0]), alert)
})

test('rinnovo che va nella direzione opposta: il delta dice quanto si perde', async () => {
  // IT registrata, destinazione diventata UE: 7,65 incassati contro 14,99 di
  // tariffa. Delta positivo = si incassa meno del dovuto, il caso che erode il
  // margine a ogni ciclo.
  const result = await run({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'pmu',
    cycle: 2,
    registeredZone: 'IT',
    destinationCountry: 'FR',
  })

  assert.equal(result.alerts.length, 1)
  const alert = result.alerts[0]
  assert.equal(alert.destinationZone, 'EU')
  assert.equal(alert.registeredShipping, 0)
  assert.equal(alert.destinationShipping, 14.99)
  assert.equal(alert.shippingDelta, 14.99)
  // Sulla scala PMU il prezzo del prodotto cambia con la zona: 60,75 (IT) contro
  // 67,50 + 14,99 (EU). Il delta totale dice quanto pesa davvero il ciclo, non
  // solo la spedizione.
  assert.equal(alert.totalDelta, 21.74)
})

test('paese mancante: alert `unknown`, nessun crash, nessun delta inventato', async () => {
  for (const missing of [undefined, null, '', '   ']) {
    const result = await run({
      subscriptionId: SUBSCRIPTION_ID,
      plan: 'tattoo',
      cycle: 4,
      registeredZone: 'EU',
      destinationCountry: missing,
    })

    assert.equal(result.alerts.length, 1, `paese ${JSON.stringify(missing)}`)
    const alert = result.alerts[0]
    assert.equal(alert.destinationZone, 'unknown')
    assert.equal(alert.destinationCountry, null)
    assert.equal(alert.reason, 'destination_unknown')
    assert.equal(alert.registeredZone, 'EU')
    assert.equal(alert.shippingDelta, null)
    assert.equal(alert.totalDelta, null)
    assert.equal(result.logs.length, 1)
  }
})

test('destinazione fuori dalle zone dell\'abbonamento: segnalata senza delta', () => {
  const mismatch = detectRenewalZoneMismatch({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'tattoo',
    cycle: 1,
    registeredZone: 'EU',
    destinationCountry: 'US',
  })
  assert.ok(mismatch)
  assert.equal(mismatch.destinationZone, 'EXTRA_EU')
  assert.equal(mismatch.reason, 'destination_outside_subscription_zones')
  assert.equal(mismatch.cost, null)
})

test('zona registrata non della scala: segnalata, non corretta', () => {
  const mismatch = detectRenewalZoneMismatch({
    subscriptionId: SUBSCRIPTION_ID,
    plan: 'tattoo',
    cycle: 1,
    registeredZone: 'CH',
    destinationCountry: 'CH',
  })
  assert.ok(mismatch)
  assert.equal(mismatch.reason, 'registered_zone_invalid')
  assert.equal(mismatch.registeredZone, 'CH')
  assert.equal(mismatch.cost, null)
})

test('il canale di consegna non puo\' bloccare il rinnovo', async () => {
  const logs: string[] = []
  await assert.doesNotReject(async () => {
    await reportRenewalZoneMismatch(
      detectRenewalZoneMismatch({
        subscriptionId: SUBSCRIPTION_ID,
        plan: 'tattoo',
        cycle: 1,
        registeredZone: 'EU',
        destinationCountry: 'IT',
      }),
      {
        notify: async () => {
          throw new Error('provider email irraggiungibile')
        },
        logger: (line) => logs.push(line),
      },
    )
  })

  assert.equal(logs.length, 2)
  assert.equal(JSON.parse(logs[0]).event, 'subscription_renewal_zone_mismatch')
  const failure = JSON.parse(logs[1])
  assert.equal(failure.event, 'subscription_renewal_zone_alert_failed')
  assert.equal(failure.subscriptionId, SUBSCRIPTION_ID)
})

test('nessuna scrittura su Stripe: il rilevamento non fa rete, la consegna esce da notifyNanobot', () => {
  const detector = readFileSync(new URL('./subscription-renewal-zone.ts', import.meta.url), 'utf8')
  // Il commento puo' nominare Stripe; il codice non deve importarlo ne'
  // chiamarlo. E il rilevamento non fa richieste di rete.
  assert.doesNotMatch(detector, /from\s+['"]stripe['"]/, 'il rilevamento importa l\'SDK Stripe')
  assert.doesNotMatch(
    detector,
    /\bstripe\.(subscriptions|customers|invoices|paymentIntents)\b/,
    'il rilevamento chiama Stripe',
  )
  assert.doesNotMatch(detector, /\bfetch\s*\(/, 'il rilevamento fa una richiesta di rete')

  // La consegna ha UN solo punto d'uscita verso la rete: `notifyNanobot`, che
  // firma la richiesta. Niente fetch diretto, niente SDK Stripe.
  const alert = readFileSync(new URL('./subscription-renewal-zone-alert.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(alert, /from\s+['"]stripe['"]/, 'la consegna importa l\'SDK Stripe')
  assert.doesNotMatch(
    alert,
    /\bstripe\.(subscriptions|customers|invoices|paymentIntents)\b/,
    'la consegna chiama Stripe',
  )
  assert.doesNotMatch(alert, /\bfetch\s*\(/, 'la consegna chiama fetch invece di notifyNanobot')
  assert.match(alert, /notifyNanobot\(RENEWAL_ZONE_HOOK/, 'la consegna non usa la rotta dedicata')
})

test('canali: se l\'email cade, l\'avviso Telegram parte lo stesso', async () => {
  const payload = buildRenewalZoneAlertPayload(
    detectRenewalZoneMismatch({
      subscriptionId: SUBSCRIPTION_ID,
      plan: 'tattoo',
      cycle: 1,
      registeredZone: 'EU',
      destinationCountry: 'CH',
    })!,
  )
  const called: string[] = []
  await assert.rejects(
    () =>
      deliverRenewalZoneAlert(payload, [
        {
          name: 'email',
          send: async () => {
            called.push('email')
            throw new Error('RESEND giu')
          },
        },
        {
          name: 'telegram',
          send: async () => {
            called.push('telegram')
          },
        },
      ]),
    (err: Error) => {
      assert.match(err.message, /email: RESEND giu/)
      assert.doesNotMatch(err.message, /telegram:/)
      return true
    },
  )
  assert.deepEqual(called, ['email', 'telegram'])
})

test('canali: se Telegram cade, l\'email resta la traccia', async () => {
  const payload = buildRenewalZoneAlertPayload(
    detectRenewalZoneMismatch({
      subscriptionId: SUBSCRIPTION_ID,
      plan: 'pmu',
      cycle: 2,
      registeredZone: 'IT',
      destinationCountry: 'FR',
    })!,
  )
  const called: string[] = []
  await assert.rejects(
    () =>
      deliverRenewalZoneAlert(payload, [
        {
          name: 'email',
          send: async () => {
            called.push('email')
          },
        },
        {
          name: 'telegram',
          send: async () => {
            called.push('telegram')
            throw new Error('ricevitore muto')
          },
        },
      ]),
    (err: Error) => {
      assert.match(err.message, /telegram: ricevitore muto/)
      assert.doesNotMatch(err.message, /email:/)
      return true
    },
  )
  assert.deepEqual(called, ['email', 'telegram'])
})

test('consegna reale: email E Telegram, nessuno dei due tolto, sulla rotta dedicata', () => {
  assert.equal(RENEWAL_ZONE_HOOK, '/hooks/foolish-subscription-zone')
  assert.deepEqual(
    RENEWAL_ZONE_ALERT_CHANNELS.map((channel) => channel.name),
    ['email', 'telegram'],
  )
  assert.equal(
    RENEWAL_ZONE_ALERT_CHANNELS.find((channel) => channel.name === 'email')?.send,
    sendRenewalZoneAlertEmail,
  )
  assert.equal(
    RENEWAL_ZONE_ALERT_CHANNELS.find((channel) => channel.name === 'telegram')?.send,
    sendRenewalZoneAlertTelegram,
  )
})

test('Telegram: POST firmato sulla rotta dedicata, con il payload del segnale', async () => {
  const payload = buildRenewalZoneAlertPayload(
    detectRenewalZoneMismatch({
      subscriptionId: SUBSCRIPTION_ID,
      plan: 'tattoo',
      cycle: 1,
      registeredZone: 'IT',
      destinationCountry: 'FR',
    })!,
  )

  const previous = {
    url: process.env.NANOBOT_WEBHOOK_URL,
    secret: process.env.NANOBOT_WEBHOOK_SECRET,
  }
  process.env.NANOBOT_WEBHOOK_URL = 'https://ricevitore.test'
  process.env.NANOBOT_WEBHOOK_SECRET = 'segreto-di-prova'

  const requests: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} })
    return new Response('{"ok":true}', { status: 200 })
  }) as typeof fetch

  try {
    await sendRenewalZoneAlertTelegram(payload)
  } finally {
    globalThis.fetch = realFetch
    for (const [key, value] of [
      ['NANOBOT_WEBHOOK_URL', previous.url],
      ['NANOBOT_WEBHOOK_SECRET', previous.secret],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  assert.equal(requests.length, 1)
  const [{ url, init }] = requests
  assert.equal(url, 'https://ricevitore.test/hooks/foolish-subscription-zone')
  assert.equal(init.method, 'POST')
  const headers = init.headers as Record<string, string>
  assert.match(headers['x-foolish-signature'], /^sha256=[0-9a-f]{64}$/)
  assert.match(headers['x-foolish-timestamp'], /^\d+$/)
  // Il corpo e' esattamente il payload del segnale: il ricevitore legge questi
  // campi (subscriptionId, zone, motivo, delta) e nient'altro.
  assert.deepEqual(JSON.parse(String(init.body)), payload)
  assert.ok(init.signal instanceof AbortSignal, 'la richiesta deve avere il timeout')
})

test('Telegram senza configurazione: l\'errore esce (throwOnError), non viene ingoiato', async () => {
  const payload = buildRenewalZoneAlertPayload(
    detectRenewalZoneMismatch({
      subscriptionId: SUBSCRIPTION_ID,
      plan: 'tattoo',
      cycle: 1,
      registeredZone: 'IT',
      destinationCountry: 'FR',
    })!,
  )
  const previousUrl = process.env.NANOBOT_WEBHOOK_URL
  delete process.env.NANOBOT_WEBHOOK_URL
  globalThis.fetch = (async () => {
    throw new Error('nessuna rete attesa')
  }) as typeof fetch
  try {
    await assert.rejects(() => sendRenewalZoneAlertTelegram(payload), /NANOBOT_WEBHOOK_URL is not configured/)
  } finally {
    globalThis.fetch = realFetch
    if (previousUrl !== undefined) process.env.NANOBOT_WEBHOOK_URL = previousUrl
  }
})

test('consegna predefinita senza credenziali: fallisce dentro report, il rinnovo non si blocca', async () => {
  const cleared = ['RESEND_API_KEY', 'ADMIN_EMAIL', 'NANOBOT_WEBHOOK_URL', 'NANOBOT_WEBHOOK_SECRET'] as const
  const previous = Object.fromEntries(cleared.map((key) => [key, process.env[key]]))
  for (const key of cleared) delete process.env[key]

  const logs: string[] = []
  globalThis.fetch = (async () => {
    throw new Error('nessuna rete attesa con le credenziali assenti')
  }) as typeof fetch
  try {
    await assert.doesNotReject(() =>
      reportRenewalZoneMismatch(
        detectRenewalZoneMismatch({
          subscriptionId: SUBSCRIPTION_ID,
          plan: 'tattoo',
          cycle: 1,
          registeredZone: 'EU',
          destinationCountry: 'CH',
        }),
        { logger: (line) => logs.push(line) },
      ),
    )
  } finally {
    globalThis.fetch = realFetch
    for (const key of cleared) {
      const value = previous[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }

  assert.equal(logs.length, 2)
  const failure = JSON.parse(logs[1])
  assert.equal(failure.event, 'subscription_renewal_zone_alert_failed')
  assert.match(failure.error, /email:/)
  assert.match(failure.error, /telegram:/)
})

test('risoluzione della zona: il paese assente non e\' extra-UE', () => {
  assert.equal(resolveDestinationZone(undefined), 'unknown')
  assert.equal(resolveDestinationZone(''), 'unknown')
  assert.equal(resolveDestinationZone('it'), 'IT')
  // La zona qui e' quella di SPEDIZIONE (confine doganale), non quella della
  // scala dei prezzi: CH e' `EU` nella scala dell'abbonamento e `EXTRA_EU` qui.
  assert.equal(resolveDestinationZone('CH'), 'EXTRA_EU')
  assert.equal(resolveDestinationZone('DE'), 'EU')
  assert.equal(resolveDestinationZone('US'), 'EXTRA_EU')
})
