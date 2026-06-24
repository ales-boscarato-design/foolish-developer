import sql from './db'

export interface B2BAuthUser {
  id: number
  email: string
  business_name: string
  password_hash: string | null
  status: string
  created_at: Date
}

export async function ensureB2BAuthTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS b2b_auth (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      business_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
}

export async function findB2BUserByEmail(email: string): Promise<B2BAuthUser | null> {
  const rows = await sql<B2BAuthUser[]>`
    SELECT id, email, business_name, password_hash, status, created_at
    FROM b2b_auth
    WHERE email = ${email.toLowerCase().trim()}
    LIMIT 1
  `
  return rows[0] ?? null
}

export async function createB2BUser(
  email: string,
  businessName: string,
  passwordHash: string,
): Promise<B2BAuthUser> {
  const rows = await sql<B2BAuthUser[]>`
    INSERT INTO b2b_auth (email, business_name, password_hash)
    VALUES (${email.toLowerCase().trim()}, ${businessName.trim()}, ${passwordHash})
    RETURNING id, email, business_name, password_hash, status, created_at
  `
  return rows[0]
}

export async function setB2BUserPassword(email: string, passwordHash: string): Promise<void> {
  await sql`
    UPDATE b2b_auth SET password_hash = ${passwordHash}
    WHERE email = ${email.toLowerCase().trim()}
  `
}
