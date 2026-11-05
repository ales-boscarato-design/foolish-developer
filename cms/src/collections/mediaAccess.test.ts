import assert from 'node:assert/strict'
import test from 'node:test'
import type { PayloadRequest } from 'payload'
import { Media } from './Media'
import { CustomerFiles } from './CustomerFiles'

const SECRET = 'test-secret'

function request(options: { user?: unknown; secret?: string } = {}): PayloadRequest {
  const headers = new Headers()
  if (options.secret !== undefined) headers.set('x-storefront-secret', options.secret)
  return { user: options.user ?? null, headers } as unknown as PayloadRequest
}

function mediaRead(req: PayloadRequest) {
  return (Media.access!.read as unknown as (args: { req: PayloadRequest }) => unknown)({ req })
}

function customerFilesRead(req: PayloadRequest) {
  return (CustomerFiles.access!.read as unknown as (args: { req: PayloadRequest }) => unknown)({ req })
}

const PRIVATE_CONSTRAINT = { visibility: { not_equals: 'private' } }

test('media.read: anonimo riceve un vincolo che esclude i documenti privati', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  assert.deepEqual(mediaRead(request()), PRIVATE_CONSTRAINT)
})

test('media.read: header storefront errato non apre i documenti privati', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  assert.deepEqual(mediaRead(request({ secret: 'wrong' })), PRIVATE_CONSTRAINT)
})

test('media.read: utente CMS autenticato vede tutto', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  assert.equal(mediaRead(request({ user: { id: 1, email: 'admin@example.test' } })), true)
})

test('media.read: lo storefront (secret corretto) legge anche i documenti privati', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  assert.equal(mediaRead(request({ secret: SECRET })), true)
})

test('media.read non e mai un booleano true per l anonimo (regressione: byte pubblici)', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  const anon = mediaRead(request())
  assert.notEqual(anon, true)
  // un booleano true non aggiunge alcun vincolo alla query del file endpoint:
  // deve essere un where constraint per far negare il documento privato
  assert.equal(typeof anon, 'object')
})

test('customer-files.read resta chiusa all anonimo', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  assert.equal(customerFilesRead(request()), false)
})

test('customer-files.read apre allo storefront con il secret corretto', () => {
  process.env.PAYLOAD_API_SECRET = SECRET
  assert.equal(customerFilesRead(request({ secret: SECRET })), true)
})
