import assert from 'node:assert/strict'
import test from 'node:test'
import type { PayloadRequest } from 'payload'
import { CustomerFiles } from './CustomerFiles'

type HookArgs = {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown> | null
  req: PayloadRequest
}

function hook() {
  const hooks = CustomerFiles.hooks?.beforeChange ?? []
  assert.equal(hooks.length, 1, 'la collection deve avere esattamente un beforeChange')
  return hooks[0] as unknown as (args: HookArgs) => Promise<Record<string, unknown>>
}

function requestWithUpdate(update: (args: Record<string, unknown>) => Promise<unknown>) {
  const calls: Record<string, unknown>[] = []
  const req = {
    payload: {
      update: async (args: Record<string, unknown>) => {
        calls.push(args)
        return update(args)
      },
    },
  } as unknown as PayloadRequest
  return { req, calls }
}

test('un file collegato a un cliente viene marcato privato', async () => {
  const { req, calls } = requestWithUpdate(async () => ({ id: 7, visibility: 'private' }))
  await hook()({ data: { customer: 42, file: 7 }, req })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].collection, 'media')
  assert.equal(calls[0].id, 7)
  assert.deepEqual(calls[0].data, { visibility: 'private' })
  assert.equal(calls[0].overrideAccess, true)
})

test('file e cliente in forma di oggetto popolato vengono risolti all id', async () => {
  const { req, calls } = requestWithUpdate(async () => ({ id: 9, visibility: 'private' }))
  await hook()({ data: { customer: { id: 1 }, file: { id: 9 } }, req })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].id, 9)
})

test('patch che non tocca ne cliente ne file usa originalDoc e non perde il vincolo', async () => {
  const { req, calls } = requestWithUpdate(async () => ({ id: 7, visibility: 'private' }))
  await hook()({ data: { title: 'nuovo titolo' }, originalDoc: { customer: 42, file: 7 }, req })
  assert.equal(calls.length, 1, 'il cliente resta valorizzato: il file deve restare privato')
})

test('cliente rimosso: nessun downgrade automatico a pubblico', async () => {
  const { req, calls } = requestWithUpdate(async () => ({ id: 7, visibility: 'private' }))
  await hook()({ data: { customer: null, file: 7 }, originalDoc: { customer: 42, file: 7 }, req })
  assert.equal(calls.length, 0)
})

test('senza cliente valorizzato nessun update (file pubblico di catalogo)', async () => {
  const { req, calls } = requestWithUpdate(async () => ({ id: 7, visibility: 'public' }))
  await hook()({ data: { customer: null, file: 7 }, req })
  await hook()({ data: { file: 7 }, originalDoc: { customer: null }, req })
  await hook()({ data: { customer: 42, file: null }, originalDoc: { customer: null, file: null }, req })
  assert.equal(calls.length, 0)
})

test('se il media non diventa privato la scrittura viene rifiutata (fail-closed)', async () => {
  const { req } = requestWithUpdate(async () => ({ id: 7, visibility: 'public' }))
  await assert.rejects(
    () => hook()({ data: { customer: 42, file: 7 }, req }),
    /Impossibile marcare privato/,
  )
})

test('se l update del media fallisce la scrittura viene rifiutata', async () => {
  const { req } = requestWithUpdate(async () => {
    throw new Error('db down')
  })
  await assert.rejects(() => hook()({ data: { customer: 42, file: 7 }, req }), /db down/)
})
