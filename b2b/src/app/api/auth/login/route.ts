import { NextRequest, NextResponse } from 'next/server'
import { ensureB2BAuthTable, findB2BUserByEmail, createB2BUser, setB2BUserPassword } from '@/lib/db-auth'
import { findProMemberByEmail } from '@/lib/db'
import { hashPassword, verifyPassword, createSessionToken, SESSION_COOKIE, type B2BSession } from '@/lib/auth'
import { sendWelcomeEmail, sendActivationNotification } from '@/lib/resend'

let tableEnsured = false

export async function POST(req: NextRequest) {
  if (!tableEnsured) {
    await ensureB2BAuthTable()
    tableEnsured = true
  }

  const body = await req.json()
  const { step, email: rawEmail } = body

  if (!rawEmail || typeof rawEmail !== 'string') {
    return NextResponse.json({ error: 'email_required' }, { status: 400 })
  }
  const email = rawEmail.toLowerCase().trim()

  // ── STEP CHECK ──────────────────────────────────────────────────────────
  if (step === 'check') {
    const b2bUser = await findB2BUserByEmail(email)
    if (b2bUser) {
      // Utente già in b2b_auth: ha password? (login) o no? (attivazione)
      return NextResponse.json({ exists: true, needsPassword: !b2bUser.password_hash })
    }
    // Non in b2b_auth — controlla pro_members per migrazione
    const proMember = await findProMemberByEmail(email)
    if (proMember) {
      return NextResponse.json({ exists: true, needsPassword: true })
    }
    // Nuovo utente
    return NextResponse.json({ exists: false, needsPassword: false })
  }

  // ── STEP AUTH ────────────────────────────────────────────────────────────
  if (step !== 'auth') {
    return NextResponse.json({ error: 'invalid_step' }, { status: 400 })
  }

  const { password, businessName } = body
  if (!password || typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 })
  }

  const b2bUser = await findB2BUserByEmail(email)
  let session: B2BSession
  let isNew = false

  if (b2bUser && b2bUser.password_hash) {
    // ── Caso 1: Login normale ──────────────────────────────────────────────
    if (b2bUser.status !== 'active') {
      return NextResponse.json({ error: 'account_suspended' }, { status: 403 })
    }
    const valid = await verifyPassword(password, b2bUser.password_hash)
    if (!valid) {
      return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
    }
    session = {
      email: b2bUser.email,
      businessName: b2bUser.business_name,
      contactName: '',
      vatNumber: '',
      status: b2bUser.status as 'active' | 'suspended',
    }
  } else if (b2bUser && !b2bUser.password_hash) {
    // ── Caso 2: Utente migrato (già in b2b_auth, senza password) ──────────
    if (b2bUser.status !== 'active') {
      return NextResponse.json({ error: 'account_suspended' }, { status: 403 })
    }
    const hash = await hashPassword(password)
    await setB2BUserPassword(email, hash)
    await sendActivationNotification(email, b2bUser.business_name)
    session = {
      email: b2bUser.email,
      businessName: b2bUser.business_name,
      contactName: '',
      vatNumber: '',
      status: b2bUser.status as 'active' | 'suspended',
    }
  } else {
    // b2bUser non esiste — controlla pro_members
    const proMember = await findProMemberByEmail(email)
    if (proMember) {
      // ── Caso 3: Migrazione da pro_members ─────────────────────────────
      if (proMember.status !== 'active') {
        return NextResponse.json({ error: 'account_suspended' }, { status: 403 })
      }
      const hash = await hashPassword(password)
      await createB2BUser(email, proMember.business_name, hash)
      await sendActivationNotification(email, proMember.business_name)
      session = {
        email: proMember.email,
        businessName: proMember.business_name,
        contactName: proMember.contact_name ?? '',
        vatNumber: proMember.vat_number ?? '',
        status: proMember.status as 'active' | 'suspended',
      }
    } else {
      // ── Caso 4: Nuova registrazione ───────────────────────────────────
      if (!businessName || typeof businessName !== 'string' || !businessName.trim()) {
        return NextResponse.json({ error: 'business_name_required' }, { status: 400 })
      }
      const hash = await hashPassword(password)
      const newUser = await createB2BUser(email, businessName, hash)
      await sendWelcomeEmail(email, businessName)
      isNew = true
      session = {
        email: newUser.email,
        businessName: newUser.business_name,
        contactName: '',
        vatNumber: '',
        status: 'active',
      }
    }
  }

  const token = await createSessionToken(session)
  const res = NextResponse.json({ ok: true, isNew })
  res.cookies.set(SESSION_COOKIE.name, token, SESSION_COOKIE.options)
  return res
}
