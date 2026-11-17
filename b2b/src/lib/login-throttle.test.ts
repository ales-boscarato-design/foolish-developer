/**
 * Test della policy di lockout, senza rete e senza database.
 *
 * Il modello e' a eventi: ogni fallimento e' una riga con timestamp e il
 * blocco si calcola contando gli eventi nella finestra. Qui si esercita sia
 * la decisione pura sia lo store in memoria, che e' il riferimento per il
 * comportamento dello store Postgres.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CHECK_IP_MAX_RECENT,
  DAY_WINDOW_MS,
  IDENTITY_MAX_RECENT,
  IDENTITY_WINDOW_MS,
  IP_MAX_RECENT,
  IP_WINDOW_MS,
  createMemoryStore,
  decideAnyBlock,
  decideBlock,
  decideCheckBlock,
  identityKey,
  ipKeyFromHeaders,
} from './login-throttle'

const NOW = new Date('2026-11-17T10:00:00.000Z')

function counters(day: number, lastFailureAt: Date | null = NOW): {
  recent: number
  day: number
  lastFailureAt: Date | null
} {
  return { recent: day, day, lastFailureAt }
}

test('cinque fallimenti bloccano il sesto con 30 minuti di attesa', async () => {
  const store = createMemoryStore()
  const email = identityKey('Mario@Example.test ')
  const ip = ipKeyFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.7' }))

  for (let attempt = 0; attempt < IDENTITY_MAX_RECENT; attempt += 1) {
    await store.recordFailures([email, ip], NOW)
  }

  const windows = await store.countWindows([email, ip], NOW)
  assert.equal(windows.get(email)?.recent, IDENTITY_MAX_RECENT)
  assert.equal(windows.get(ip)?.recent, IDENTITY_MAX_RECENT)

  const decision = decideAnyBlock(
    [
      { kind: 'identity', counters: windows.get(email) },
      { kind: 'ip', counters: windows.get(ip) },
    ],
    NOW,
  )

  assert.equal(decision.blocked, true)
  assert.equal(decision.retryAfterSeconds, 30 * 60)
})

test('la durata del blocco cresce con i fallimenti nelle 24 ore', () => {
  assert.deepEqual(decideBlock(counters(5), 'identity', NOW), {
    blocked: true,
    retryAfterSeconds: 1_800,
  })
  assert.deepEqual(decideBlock(counters(10), 'identity', NOW), {
    blocked: true,
    retryAfterSeconds: 7_200,
  })
  assert.deepEqual(decideBlock(counters(20), 'identity', NOW), {
    blocked: true,
    retryAfterSeconds: 86_400,
  })
})

test('cinque fallimenti vecchi di 31 minuti non bloccano', async () => {
  const store = createMemoryStore()
  const key = identityKey('vecchio@example.test')
  const old = new Date(NOW.getTime() - 31 * 60 * 1000)

  for (let attempt = 0; attempt < IDENTITY_MAX_RECENT; attempt += 1) {
    await store.recordFailures([key], old)
  }

  const windows = await store.countWindows([key], NOW)
  const entry = windows.get(key)
  assert.equal(entry?.recent, 0)
  assert.equal(entry?.day, IDENTITY_MAX_RECENT)
  assert.equal(entry?.lastFailureAt?.getTime(), old.getTime())

  const decision = decideAnyBlock([{ kind: 'identity', counters: entry }], NOW)
  assert.equal(decision.blocked, false)
})

test('le soglie di identita e IP sono separate', () => {
  const five = counters(5)
  assert.equal(decideBlock(five, 'identity', NOW).blocked, true)
  assert.equal(decideBlock(five, 'ip', NOW).blocked, false)

  const twenty = counters(20)
  assert.equal(decideBlock(twenty, 'ip', NOW).blocked, true)
  assert.equal(decideBlock(twenty, 'ip', NOW).retryAfterSeconds, 86_400)
})

test('nessun blocco sotto le soglie anche con finestre piene', () => {
  assert.equal(decideBlock(counters(IDENTITY_MAX_RECENT - 1), 'identity', NOW).blocked, false)
  assert.equal(decideBlock(counters(IP_MAX_RECENT - 1), 'ip', NOW).blocked, false)
  assert.equal(decideCheckBlock(counters(CHECK_IP_MAX_RECENT - 1), NOW).blocked, false)
  assert.equal(decideCheckBlock(counters(CHECK_IP_MAX_RECENT), NOW).blocked, true)
})

test('le finestre della policy sono quelle dichiarate', () => {
  assert.equal(IDENTITY_WINDOW_MS, 30 * 60 * 1000)
  assert.equal(IP_WINDOW_MS, 30 * 60 * 1000)
  assert.equal(DAY_WINDOW_MS, 24 * 60 * 60 * 1000)
})

test('ipKeyFromHeaders usa l ultima voce non vuota di x-forwarded-for', () => {
  assert.equal(
    ipKeyFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.1, 198.51.100.2' })),
    'ip:198.51.100.2',
  )
  assert.equal(
    ipKeyFromHeaders(new Headers({ 'x-forwarded-for': ' 203.0.113.1 , , 198.51.100.9 , ' })),
    'ip:198.51.100.9',
  )
})

test('ipKeyFromHeaders ripiega su x-real-ip e poi su unknown', () => {
  assert.equal(
    ipKeyFromHeaders(new Headers({ 'x-real-ip': '198.51.100.7' })),
    'ip:198.51.100.7',
  )
  assert.equal(
    ipKeyFromHeaders(
      new Headers({ 'x-forwarded-for': ' , , ', 'x-real-ip': ' 198.51.100.8 ' }),
    ),
    'ip:198.51.100.8',
  )
  assert.equal(ipKeyFromHeaders(new Headers()), 'ip:unknown')
})

test('reset svuota i contatori delle chiavi indicate', async () => {
  const store = createMemoryStore()
  const email = identityKey('reset@example.test')
  const ip = ipKeyFromHeaders(new Headers({ 'x-forwarded-for': '203.0.113.9' }))

  for (let attempt = 0; attempt < IDENTITY_MAX_RECENT; attempt += 1) {
    await store.recordFailures([email, ip], NOW)
  }
  assert.equal((await store.countWindows([email, ip], NOW)).get(email)?.recent, 5)

  await store.reset([email, ip])

  const windows = await store.countWindows([email, ip], NOW)
  assert.deepEqual(windows.get(email), { recent: 0, day: 0, lastFailureAt: null })
  assert.deepEqual(windows.get(ip), { recent: 0, day: 0, lastFailureAt: null })
  assert.equal(decideAnyBlock([{ kind: 'identity', counters: windows.get(email) }], NOW).blocked, false)
})
