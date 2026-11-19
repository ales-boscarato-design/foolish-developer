import { ensureB2BAuthTable, findB2BUserByEmail, createB2BUser, setB2BUserPassword } from '@/lib/db-auth'
import sql, { findProMemberByEmail } from '@/lib/db'
import { hashPassword, verifyPassword, createSessionToken } from '@/lib/auth'
import { sendWelcomeEmail, sendActivationNotification } from '@/lib/resend'
import { createLoginHandler, type LoginDeps } from '@/lib/login-handler'
import { createPostgresStore, ensureLoginThrottleTable } from '@/lib/login-throttle'

/**
 * Le tabelle si creano una volta sola per processo. Se l'ensure fallisce non
 * memorizziamo la promise: il tentativo successivo puo' riprovare.
 */
let readyPromise: Promise<void> | null = null

function ensureReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await ensureB2BAuthTable()
      await ensureLoginThrottleTable(sql)
    })().catch((error) => {
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

const deps: LoginDeps = {
  findB2BUserByEmail,
  findProMemberByEmail,
  createB2BUser,
  setB2BUserPassword,
  hashPassword,
  verifyPassword,
  createSessionToken,
  sendWelcomeEmail,
  sendActivationNotification,
  store: createPostgresStore(sql),
  now: () => new Date(),
  ensureReady,
}

export const POST = createLoginHandler(deps)
