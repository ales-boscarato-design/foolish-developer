import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, type B2BSession } from './auth'
import {
  checkKeyFromHeaders,
  decideAnyBlock,
  decideCheckBlock,
  identityKey,
  ipKeyFromHeaders,
  type LoginAttemptStore,
} from './login-throttle'

/**
 * Factory della rotta di login B2B.
 *
 * La rotta vera resta sottile (`route.ts` esporta solo la POST): con Next 16
 * un file `route.ts` che esporta funzioni arbitrarie non passa il controllo
 * degli export. Qui arriva tutto cio' che tocca rete, database e bcrypt, cosi'
 * i test possono iniettare fakes e verificare l'ordine delle operazioni.
 */
export interface LoginDeps {
  findB2BUserByEmail: typeof import('./db-auth').findB2BUserByEmail
  findProMemberByEmail: typeof import('./db').findProMemberByEmail
  createB2BUser: typeof import('./db-auth').createB2BUser
  setB2BUserPassword: typeof import('./db-auth').setB2BUserPassword
  hashPassword: typeof import('./auth').hashPassword
  verifyPassword: typeof import('./auth').verifyPassword
  createSessionToken: typeof import('./auth').createSessionToken
  sendWelcomeEmail: typeof import('./resend').sendWelcomeEmail
  sendActivationNotification: typeof import('./resend').sendActivationNotification
  store: LoginAttemptStore
  now: () => Date
  /** Tabelle create una volta sola dalle dipendenze reali. */
  ensureReady?: () => Promise<void>
}

function tooMany(seconds: number): NextResponse {
  return NextResponse.json(
    { error: 'too_many_attempts' },
    {
      status: 429,
      // Minimo 1: un Retry-After 0 non fermerebbe il client.
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(seconds))) },
    },
  )
}

function unavailable(): NextResponse {
  return NextResponse.json({ error: 'login_unavailable' }, { status: 503 })
}

export function createLoginHandler(deps: LoginDeps): (req: NextRequest) => Promise<NextResponse> {
  return async function POST(req: NextRequest): Promise<NextResponse> {
    if (deps.ensureReady) {
      try {
        await deps.ensureReady()
      } catch {
        // Senza tabelle non si puo' contare: fail-closed, non fail-open.
        return unavailable()
      }
    }

    const body = await req.json()
    const { step, email: rawEmail } = body

    if (!rawEmail || typeof rawEmail !== 'string') {
      return NextResponse.json({ error: 'email_required' }, { status: 400 })
    }
    const email = rawEmail.toLowerCase().trim()

    // ── STEP CHECK ──────────────────────────────────────────────────────────
    if (step === 'check') {
      const now = deps.now()
      // Chiave dedicata: i check non devono consumare la soglia dei fallimenti
      // di login, che ha una policy piu' stretta (20 contro 60).
      const ipCheckKey = checkKeyFromHeaders(req.headers)

      try {
        // Si registra prima e si conta dopo: cosi' la sessantesima richiesta
        // e' quella che supera la soglia e riceve 429, non la sessantunesima.
        await deps.store.recordCheck(ipCheckKey, now)
        const windows = await deps.store.countWindows([ipCheckKey], now)
        const decision = decideCheckBlock(windows.get(ipCheckKey), now)
        if (decision.blocked) return tooMany(decision.retryAfterSeconds)
      } catch {
        return unavailable()
      }

      const b2bUser = await deps.findB2BUserByEmail(email)
      if (b2bUser) {
        return NextResponse.json({ exists: true, needsPassword: !b2bUser.password_hash })
      }
      const proMember = await deps.findProMemberByEmail(email)
      if (proMember) {
        return NextResponse.json({ exists: true, needsPassword: true })
      }
      return NextResponse.json({ exists: false, needsPassword: false })
    }

    // ── STEP AUTH ────────────────────────────────────────────────────────────
    if (step !== 'auth') {
      return NextResponse.json({ error: 'invalid_step' }, { status: 400 })
    }

    const now = deps.now()
    const emailKey = identityKey(email)
    const ipKey = ipKeyFromHeaders(req.headers)
    const keys = [emailKey, ipKey]

    // Il blocco si valuta prima di qualunque verifica della password: al sesto
    // tentativo bcrypt non viene nemmeno sfiorato.
    try {
      const windows = await deps.store.countWindows(keys, now)
      const decision = decideAnyBlock(
        [
          { kind: 'identity', counters: windows.get(emailKey) },
          { kind: 'ip', counters: windows.get(ipKey) },
        ],
        now,
      )
      if (decision.blocked) return tooMany(decision.retryAfterSeconds)
    } catch {
      return unavailable()
    }

    const { password, businessName } = body
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'password_too_short' }, { status: 400 })
    }

    // Un fallimento va contato su entrambe le chiavi. Se lo store non risponde
    // la richiesta e' 503: meglio negare il login che lasciarlo senza freno.
    async function recordFailure(): Promise<NextResponse | null> {
      try {
        await deps.store.recordFailures(keys, now)
      } catch {
        return unavailable()
      }
      return null
    }

    const b2bUser = await deps.findB2BUserByEmail(email)
    let session: B2BSession
    let isNew = false

    if (b2bUser && b2bUser.password_hash) {
      // ── Caso 1: Login normale ──────────────────────────────────────────────
      if (b2bUser.status !== 'active') {
        return NextResponse.json({ error: 'account_suspended' }, { status: 403 })
      }
      const valid = await deps.verifyPassword(password, b2bUser.password_hash)
      if (!valid) {
        const failure = await recordFailure()
        if (failure) return failure
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
      const hash = await deps.hashPassword(password)
      await deps.setB2BUserPassword(email, hash)
      await deps.sendActivationNotification(email, b2bUser.business_name)
      session = {
        email: b2bUser.email,
        businessName: b2bUser.business_name,
        contactName: '',
        vatNumber: '',
        status: b2bUser.status as 'active' | 'suspended',
      }
    } else {
      // b2bUser non esiste — controlla pro_members
      const proMember = await deps.findProMemberByEmail(email)
      if (proMember) {
        // ── Caso 3: Migrazione da pro_members ─────────────────────────────
        if (proMember.status !== 'active') {
          return NextResponse.json({ error: 'account_suspended' }, { status: 403 })
        }
        const hash = await deps.hashPassword(password)
        await deps.createB2BUser(email, proMember.business_name, hash)
        await deps.sendActivationNotification(email, proMember.business_name)
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
          // Email inesistente senza businessName: e' un login fallito, non un
          // errore di validazione. Stesso corpo del caso "password sbagliata"
          // per non rivelare se l'email esiste.
          const failure = await recordFailure()
          if (failure) return failure
          return NextResponse.json({ error: 'invalid_credentials' }, { status: 401 })
        }
        const hash = await deps.hashPassword(password)
        const newUser = await deps.createB2BUser(email, businessName, hash)
        await deps.sendWelcomeEmail(email, businessName)
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

    // Al successo si azzera la sola identita': un login valido non deve
    // portarsi dietro i fallimenti precedenti. La chiave IP non si azzera
    // MAI, nemmeno per un login riuscito: la registrazione B2B e' aperta,
    // quindi chiunque puo' procurarsi un account valido e usarlo per
    // svuotare il freno per IP dopo una raffica di tentativi su altre email.
    // Il contatore IP deve decadere solo con la finestra temporale.
    try {
      await deps.store.reset([emailKey])
    } catch {
      return unavailable()
    }

    const token = await deps.createSessionToken(session)
    const res = NextResponse.json({ ok: true, isNew })
    res.cookies.set(SESSION_COOKIE.name, token, SESSION_COOKIE.options)
    return res
  }
}
