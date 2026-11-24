import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { PgDialect } from 'drizzle-orm/pg-core'
import { down, up } from '../migrations/20261121_100000_add_product_unlisted'

test('product unlisted migration is repeatable and reversible on an isolated PostgreSQL database', {
  skip: !process.env.PG_TEST_DATABASE_URL,
}, async () => {
  const connectionString = process.env.PG_TEST_DATABASE_URL
  if (!connectionString) return
  const url = new URL(connectionString)
  assert.ok(['localhost', '127.0.0.1', '::1'].includes(url.hostname), 'test database must be local')
  assert.match(url.pathname, /^\/(?:unlisted_test_[a-z0-9_]+|refund_orders_isolated)$/, 'test database name must be isolated')
  const client = new Client({ connectionString })
  const dialect = new PgDialect()
  const schemaName = `unlisted_test_${randomUUID().replaceAll('-', '')}`
  await client.connect()
  const db = {
    execute: async (statement: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const query = dialect.sqlToQuery(statement)
      return client.query(query.sql, query.params)
    },
  }
  try {
    await client.query(`CREATE SCHEMA "${schemaName}"`)
    await client.query(`SET search_path TO "${schemaName}"`)
    await client.query('CREATE TABLE IF NOT EXISTS products (id serial PRIMARY KEY)')
    await up({ db } as never)
    await up({ db } as never)
    const schema = await client.query<{ column_name: string; is_nullable: string; column_default: string | null; character_maximum_length: number | null }>(
      `SELECT column_name, is_nullable, column_default, character_maximum_length
       FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'products'`,
    )
    const unlisted = schema.rows.find((row) => row.column_name === 'unlisted')
    const supersededBy = schema.rows.find((row) => row.column_name === 'superseded_by')
    assert.equal(unlisted?.is_nullable, 'NO')
    assert.match(unlisted?.column_default ?? '', /false/i)
    assert.equal(supersededBy?.character_maximum_length, 63)
    const index = await client.query(`SELECT to_regclass('products_unlisted_idx') AS name`)
    assert.equal(index.rows[0]?.name, 'products_unlisted_idx')

    await down({ db } as never)
    const afterDown = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'products'`,
    )
    assert.equal(afterDown.rows.some((row) => ['unlisted', 'superseded_by'].includes(row.column_name)), false)
    assert.equal((await client.query(`SELECT to_regclass('products_unlisted_idx') AS name`)).rows[0]?.name, null)
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
    await client.end()
  }
})
