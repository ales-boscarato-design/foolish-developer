/**
 * Test della rotta di login B2B tramite la factory, senza rete e senza
 * database. Le dipendenze reali sono sostituite da fakes in memoria; la
 * `NextRequest` e la `NextResponse` sono quelle vere di `next/server`.
 *
 * I casi R1-R6 sono i rilievi 08 e 12 dell'audit: blocco al sesto tentativo
 * prima di bcrypt, risposta indistinguibile fra email esistente e
 * inesistente, azzeramento al successo, registrazione ancora funzionante,
 * fail-closed sullo store e limite del passo `check`.
 *
 * R7-R9 sono le correzioni Fase 1-bis: i `check` hanno una chiave propria e
 * non consumano la soglia dei fallimenti; la registrazione azzera solo
 * l'identita' e lascia intatto il contatore IP.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'

import { createLoginHandler, type LoginDeps } from '../../../../lib/login-handler'
import { createMemoryStore } from '../../../../lib/login-throttle'
import type { B2BAuthUser } from '../../../../lib/db-auth'

const NOW = new Date('2026-11-17T10:00:00.000Z')
const IP = '203.0.113.50'
const INVALID = '{"error":"invalid_credentials"}'
const TOO_MANY = '{"error":"too_many_attempts"}'
const UNAVAILABLE = '{"error":"login_unavailable"}'

interface Harness {
  deps: LoginDeps
  users: Map<string, B2BAuthUser>
  verifyCalls: number
  welcomeCalls: number
}

function existingUser(
  email = 'mario@example.test',
  password = 'correct-password',
): B2BAuthUser {
  return {
    id: 1,
    email,
    business_name: 'Trattoria Test',
    password_hash: `hash:${password}`,
    status: 'active',
    created_at: NOW,
  }
}

function makeHarness(options: { users?: B2BAuthUser[] } = {}): Harness {
  const users = new Map<string, B2BAuthUser>()
  for (const user of options.users ?? []) users.set(user.email, user)

  let nextId = 1
  const harness: Harness = {
    deps: undefined as unknown as LoginDeps,
    users,
    verifyCalls: 0,
    welcomeCalls: 0,
  }

  harness.deps = {
    findB2BUserByEmail: async (email) => users.get(email.toLowerCase().trim()) ?? null,
    findProMemberByEmail: async () => null,
    createB2BUser: async (email, businessName, passwordHash) => {
      const user: B2BAuthUser = {
        id: nextId++,
        email: email.toLowerCase().trim(),
        business_name: businessName.trim(),
        password_hash: passwordHash,
        status: 'active',
        created_at: NOW,
      }
      users.set(user.email, user)
      return user
    },
    setB2BUserPassword: async (email, passwordHash) => {
      const user = users.get(email)
      if (user) user.password_hash = passwordHash
    },
    hashPassword: async (password) => `hash:${password}`,
    verifyPassword: async (password, hash) => {
      harness.verifyCalls += 1
      return hash === `hash:${password}`
    },
    createSessionToken: async (session) => `session-token-for-${session.email}`,
    sendWelcomeEmail: async () => {
      harness.welcomeCalls += 1
    },
    sendActivationNotification: async () => {},
    store: createMemoryStore(),
    now: () => NOW,
  }

  return harness
}

async function post(
  deps: LoginDeps,
  body: Record<string, unknown>,
  ip = IP,
): Promise<Response> {
  const req = new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
  return createLoginHandler(deps)(req)
}

function auth(email: string, password: string, businessName?: string): Record<string, unknown> {
  const body: Record<string, unknown> = { step: 'auth', email, password }
  if (businessName !== undefined) body.businessName = businessName
  return body
}

test('R1: la sesta password sbagliata e bloccata prima di bcrypt', async () => {
  const harness = makeHarness({ users: [existingUser()] })

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await post(harness.deps, auth('Mario@Example.test', 'wrong-password'))
    assert.equal(res.status, 401)
    assert.equal(await res.text(), INVALID)
  }
  assert.equal(harness.verifyCalls, 5, 'bcrypt deve essere chiamato una volta per tentativo')

  const sixth = await post(harness.deps, auth('Mario@Example.test', 'wrong-password'))
  assert.equal(sixth.status, 429)
  assert.equal(await sixth.text(), TOO_MANY)
  assert.equal(sixth.headers.get('retry-after'), '1800')
  assert.equal(harness.verifyCalls, 5, 'il sesto tentativo non deve chiamare bcrypt')
})

test('R2: email esistente ed email inesistente sono indistinguibili', async () => {
  const existing = makeHarness({ users: [existingUser()] })
  const missing = makeHarness()
  const existingBodies: string[] = []
  const missingBodies: string[] = []

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const a = await post(existing.deps, auth('mario@example.test', 'wrong-password'))
    const b = await post(missing.deps, auth('nessuno@example.test', 'wrong-password'))
    assert.equal(a.status, 401)
    assert.equal(b.status, 401)
    existingBodies.push(await a.text())
    missingBodies.push(await b.text())
  }

  assert.deepEqual(missingBodies, existingBodies)
  assert.deepEqual(existingBodies, Array(5).fill(INVALID))

  const sixthExisting = await post(existing.deps, auth('mario@example.test', 'wrong-password'))
  const sixthMissing = await post(missing.deps, auth('nessuno@example.test', 'wrong-password'))
  assert.equal(sixthExisting.status, 429)
  assert.equal(sixthMissing.status, 429)
  const existingBlocked = await sixthExisting.text()
  const missingBlocked = await sixthMissing.text()
  assert.equal(missingBlocked, existingBlocked)
  assert.equal(existingBlocked, TOO_MANY)
})

test('R3: il successo azzera i contatori, il fallimento successivo non e 429', async () => {
  const harness = makeHarness({ users: [existingUser()] })

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await post(harness.deps, auth('mario@example.test', 'wrong-password'))
    assert.equal(res.status, 401)
  }

  const ok = await post(harness.deps, auth('mario@example.test', 'correct-password'))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, isNew: false })
  assert.match(ok.headers.get('set-cookie') ?? '', /b2b_session=/)

  const after = await post(harness.deps, auth('mario@example.test', 'wrong-password'))
  assert.equal(after.status, 401, 'dopo il reset il contatore riparte da zero')
  assert.equal(await after.text(), INVALID)
})

test('R4: la registrazione continua a funzionare e non eredita un blocco', async () => {
  const harness = makeHarness()

  const registration = await post(
    harness.deps,
    auth('nuovo@example.test', 'password-1', 'Nuova Attivita'),
  )
  assert.equal(registration.status, 200)
  assert.deepEqual(await registration.json(), { ok: true, isNew: true })
  assert.equal(harness.users.get('nuovo@example.test')?.business_name, 'Nuova Attivita')

  const wrong = await post(harness.deps, auth('nuovo@example.test', 'wrong-password'))
  assert.equal(wrong.status, 401)
  assert.equal(await wrong.text(), INVALID)
})

test('R5: store irraggiungibile -> 503 fail-closed, mai bcrypt', async () => {
  const harness = makeHarness({ users: [existingUser()] })
  const down = async (): Promise<never> => {
    throw new Error('database non raggiungibile')
  }
  harness.deps.store = {
    recordFailures: down,
    countWindows: down,
    recordCheck: down,
    reset: down,
  }

  const res = await post(harness.deps, auth('mario@example.test', 'correct-password'))
  assert.equal(res.status, 503)
  assert.equal(await res.text(), UNAVAILABLE)
  assert.equal(harness.verifyCalls, 0)
})

test('R6: il passo check si ferma alla sessantesima richiesta per IP', async () => {
  const harness = makeHarness()

  for (let attempt = 1; attempt <= 59; attempt += 1) {
    const res = await post(harness.deps, {
      step: 'check',
      email: `utente${attempt}@example.test`,
    })
    assert.equal(res.status, 200, `richiesta ${attempt}`)
    assert.deepEqual(await res.json(), { exists: false, needsPassword: false })
  }

  const blocked = await post(harness.deps, {
    step: 'check',
    email: 'utente60@example.test',
  })
  assert.equal(blocked.status, 429)
  assert.equal(await blocked.text(), TOO_MANY)
  // Sessanta eventi nella finestra giornaliera: la policy progressiva applica
  // la durata massima di 24 ore.
  assert.equal(blocked.headers.get('retry-after'), '86400')
})

test('R7: i check sotto soglia non consumano la soglia dei fallimenti', async () => {
  const harness = makeHarness({ users: [existingUser()] })

  // Trenta check restano sotto la soglia dei check (60): non devono sommarsi
  // ai fallimenti di login sulla stessa chiave IP.
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const res = await post(harness.deps, {
      step: 'check',
      email: `utente${attempt}@example.test`,
    })
    assert.equal(res.status, 200, `check ${attempt}`)
  }

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await post(harness.deps, auth('mario@example.test', 'wrong-password'))
    assert.equal(res.status, 401, `login sbagliato ${attempt}`)
    assert.equal(await res.text(), INVALID)
  }

  // Quinto fallimento: identita' a 4 prima del tentativo, quindi ancora 401.
  // Se i check condividessero la chiave IP, l'IP sarebbe a 34 e qui arriverebbe
  // un 429.
  const fifth = await post(harness.deps, auth('mario@example.test', 'wrong-password'))
  assert.equal(fifth.status, 401, 'i check non devono consumare la soglia dei fallimenti')
  assert.equal(await fifth.text(), INVALID)
})

test('R8: il blocco del passo check non blocca il login', async () => {
  const harness = makeHarness({ users: [existingUser('altro@example.test')] })

  for (let attempt = 1; attempt <= 59; attempt += 1) {
    const res = await post(harness.deps, {
      step: 'check',
      email: `utente${attempt}@example.test`,
    })
    assert.equal(res.status, 200, `check ${attempt}`)
  }

  const blockedCheck = await post(harness.deps, { step: 'check', email: 'utente60@example.test' })
  assert.equal(blockedCheck.status, 429)
  assert.equal(await blockedCheck.text(), TOO_MANY)

  // I sessanta check sono sulla chiave `ipcheck:`: il login di un'email diversa
  // e senza fallimenti resta un normale 401.
  const login = await post(harness.deps, auth('altro@example.test', 'wrong-password'))
  assert.equal(login.status, 401, 'il blocco dei check non deve bloccarci il login')
  assert.equal(await login.text(), INVALID)
})

test('R9: la registrazione non azzera il contatore IP', async () => {
  const harness = makeHarness()

  // Diciannove email distinte dalla stessa IP portano il contatore IP a 19
  // senza toccare la soglia per identita' (5), che bloccherebbe la stessa
  // email. Con 4 soli fallimenti il contatore IP resterebbe sotto i 20 e il
  // caso non distinguerebbe la correzione.
  for (let attempt = 1; attempt <= 19; attempt += 1) {
    const res = await post(harness.deps, auth(`nessuno${attempt}@example.test`, 'wrong-password'))
    assert.equal(res.status, 401, `fallimento ${attempt}`)
    assert.equal(await res.text(), INVALID)
  }

  const registration = await post(
    harness.deps,
    auth('nuovo@example.test', 'password-1', 'Nuova Attivita'),
  )
  assert.equal(registration.status, 200)
  assert.deepEqual(await registration.json(), { ok: true, isNew: true })

  const first = await post(harness.deps, auth('nuovo@example.test', 'wrong-password'))
  assert.equal(first.status, 401)
  assert.equal(await first.text(), INVALID)

  // Primo fallimento: l'IP arriva a 20. Secondo fallimento: l'IP e' ancora a
  // 20 e deve bloccare. Se la registrazione avesse azzerato l'IP, qui ci
  // sarebbe un 401.
  const second = await post(harness.deps, auth('nuovo@example.test', 'wrong-password'))
  assert.equal(second.status, 429, 'il contatore IP non deve essere azzerato dalla registrazione')
  assert.equal(await second.text(), TOO_MANY)
})
