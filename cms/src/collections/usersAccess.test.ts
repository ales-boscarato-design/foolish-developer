import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { PayloadRequest } from 'payload'
import { Users, usersUnlockAccess } from './Users'

/**
 * Guardie di regressione sul lockout del CMS.
 *
 * Il difetto dell'advisor (GHSA-jg8r-5jh2-v2xj / CVE-2026-11779) e' che
 * `access.unlock` era `defaultAccess`, cioe' "basta essere autenticati": qualunque
 * utente poteva azzerare il lockout di qualunque altro. Questi test bloccano due
 * ritorni al passato: la regola applicativa (solo il proprio id) e la versione di
 * payload che porta `defaultUnlockAccess` (>= 3.90), oltre alla forma della
 * collection, che non deve tornare inline nel config.
 */

const CMS_ROOT = new URL('../../', import.meta.url)

function unlockFor(user: { id: number | string; collection: string } | null) {
  const req = { user } as unknown as PayloadRequest
  return (usersUnlockAccess as unknown as (args: { req: PayloadRequest }) => unknown)({ req })
}

test('users.unlock: senza utente la risposta e false, non un vincolo', () => {
  assert.equal(unlockFor(null), false)
})

test('users.unlock: un utente autenticato puo sbloccare solo il proprio id', () => {
  const result = unlockFor({ id: 7, collection: 'users' })
  assert.notEqual(result, true)
  assert.deepEqual(result, { id: { equals: 7 } })
  // La forma esatta conta: un `where` diverso (o un booleano true) potrebbe
  // combaciare con un altro id e riaprire l'abuso.
  assert.deepEqual(Object.keys(result as object), ['id'])
})

test('users.auth: lockout e API key restano quelli attuali', () => {
  const auth = Users.auth as {
    lockTime?: number
    maxLoginAttempts?: number
    useAPIKey?: boolean
  }
  assert.equal(auth.maxLoginAttempts, 5)
  assert.equal(auth.lockTime, 30 * 60 * 1000)
  assert.equal(auth.useAPIKey, true)
})

test('guardia di versione: payload >= 3.90 e defaultUnlockAccess presente', () => {
  const packageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL('package.json', CMS_ROOT)), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  const version = packageJson.dependencies?.payload

  assert.equal(typeof version, 'string', 'payload non e una dipendenza diretta del CMS')
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version as string)
  assert.ok(match, `versione payload non parsabile: ${version}`)

  const major = Number(match[1])
  const minor = Number(match[2])
  assert.ok(
    major > 3 || (major === 3 && minor >= 90),
    `payload ${version} e precedente a 3.90: il default unlock torna aggirabile`,
  )

  const defaultUnlock = fileURLToPath(
    new URL('node_modules/payload/dist/auth/defaultUnlockAccess.js', CMS_ROOT),
  )
  assert.equal(
    existsSync(defaultUnlock),
    true,
    'manca node_modules/payload/dist/auth/defaultUnlockAccess.js (payload < 3.90?)',
  )

  const defaults = readFileSync(
    fileURLToPath(
      new URL('node_modules/payload/dist/collections/config/defaults.js', CMS_ROOT),
    ),
    'utf8',
  )
  assert.match(defaults, /unlock:\s*defaultUnlockAccess/)
})

test('guardia strutturale: users vive in ./collections/Users, non inline nel config', () => {
  const config = readFileSync(
    fileURLToPath(new URL('src/payload.config.ts', CMS_ROOT)),
    'utf8',
  )
  assert.match(config, /import\s*\{\s*Users\s*\}\s*from\s*'\.\/collections\/Users'/)
  assert.doesNotMatch(config, /slug:\s*['"]users['"]/)
})
