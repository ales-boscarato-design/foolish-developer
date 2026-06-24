# B2B Login Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire magic link + classic login con un sistema email+password auto-registrazione, mantenendo Resend per notifiche e Umami per tracking.

**Architecture:** Una nuova tabella `b2b_auth` (gestita direttamente dal b2b app, indipendente da Payload) memorizza email + password_hash. Il form di login è progressivo: prima si inserisce l'email, poi il backend determina se mostrare solo password (utente esistente) o password + nome attività (nuovo utente). Al primo accesso viene inviata welcome email via Resend con BCC a Frank.

**Tech Stack:** Next.js 16, bcryptjs, postgres (già installato), Resend (già installato), jose JWT (già installato), Umami (già configurato in layout.tsx)

## Global Constraints

- Working dir: `foolish-storefront/b2b/`
- Typecheck prima di ogni commit: `npx tsc --noEmit` dalla directory `b2b/`
- Nessun push prima di aver completato tutti i task (regola un-push-per-sessione in CLAUDE.md)
- `bcryptjs` (non `bcrypt` nativo) — compatibile con deployment Railway senza build tools nativi
- Session cookie: `b2b_session`, httpOnly, secure in prod, 30 giorni — NON cambiare
- Variabili d'ambiente esistenti: `B2B_SESSION_SECRET`, `DATABASE_URL`, `RESEND_API_KEY` — usare quelle, non aggiungerne
- `B2B_MAGIC_SECRET` NON va rimossa ora (può restare inutilizzata, rimozione è operazione Railway separata)
- Email mittente: `The Foolish Butcher <ordini@updates.thefoolishbutcher.com>`
- BCC Frank: `support.foolish@agentmail.to`
- Umami website-id: già caricato in `layout.tsx`, usare `window.umami?.track()`

---

## File Map

| File | Azione | Responsabilità |
|------|--------|----------------|
| `src/lib/db-auth.ts` | **Crea** | Tabella `b2b_auth`: creazione schema + CRUD (createTable, findByEmail, createUser, setPassword) |
| `src/lib/auth.ts` | **Modifica** | Rimuove magic token functions; aggiunge `hashPassword`, `verifyPassword`; semplifica `B2BSession` |
| `src/app/api/auth/login/route.ts` | **Crea** | Unico endpoint POST: gestisce check-email + auth (login/registrazione/attivazione migrazione) |
| `src/lib/resend.ts` | **Modifica** | Rimuove `sendMagicLink`; aggiunge `sendWelcomeEmail` |
| `src/app/login/page.tsx` | **Riscrivi** | Form progressivo: step email → step password/registrazione |
| `src/components/LoginTracker.tsx` | **Modifica** | Aggiunge tracking `reseller_register` per `?_register=1` |
| `src/app/api/auth/magic-link/route.ts` | **Elimina** | Non più usato |
| `src/app/api/auth/verify/route.ts` | **Elimina** | Non più usato |
| `src/app/auth/verify/page.tsx` | **Elimina** | Non più usato |
| `src/app/api/auth/classic-login/route.ts` | **Elimina** | Non più usato |

---

## Task 1: Installa bcryptjs e crea `src/lib/db-auth.ts`

**Files:**
- Create: `b2b/src/lib/db-auth.ts`
- Modify: `b2b/package.json`

**Interfaces:**
- Produces:
  - `ensureB2BAuthTable(): Promise<void>` — crea tabella se non esiste
  - `findB2BUserByEmail(email: string): Promise<B2BAuthUser | null>`
  - `createB2BUser(email: string, businessName: string, passwordHash: string): Promise<B2BAuthUser>`
  - `setB2BUserPassword(email: string, passwordHash: string): Promise<void>`
  - `interface B2BAuthUser { id: number; email: string; business_name: string; password_hash: string | null; status: string; created_at: Date }`

- [ ] **Step 1: Installa bcryptjs**

```bash
cd b2b && npm install bcryptjs && npm install --save-dev @types/bcryptjs
```

Verifica che `package.json` ora contenga `"bcryptjs"` nelle dipendenze.

- [ ] **Step 2: Crea `src/lib/db-auth.ts`**

```typescript
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
```

- [ ] **Step 3: Typecheck**

```bash
cd b2b && npx tsc --noEmit
```

Output atteso: nessun errore.

- [ ] **Step 4: Commit**

```bash
cd b2b && git add src/lib/db-auth.ts package.json package-lock.json
git commit -m "feat(b2b): installa bcryptjs, crea lib db-auth con tabella b2b_auth"
```

---

## Task 2: Aggiorna `src/lib/auth.ts`

**Files:**
- Modify: `b2b/src/lib/auth.ts`

**Interfaces:**
- Consumes: niente di nuovo
- Produces:
  - Rimuove: `createMagicToken`, `verifyMagicToken` (e relativo `MAGIC_SECRET`)
  - Aggiunge: `hashPassword(password: string): Promise<string>`
  - Aggiunge: `verifyPassword(password: string, hash: string): Promise<boolean>`
  - Modifica `B2BSession`: rimuove `proMemberId`; `contactName` e `vatNumber` diventano opzionali (`string | undefined`)

- [ ] **Step 1: Riscrivi `src/lib/auth.ts`**

Sostituisci l'intero file con:

```typescript
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'

const SESSION_SECRET = new TextEncoder().encode(process.env.B2B_SESSION_SECRET!)

export interface B2BSession {
  email: string
  businessName: string
  contactName: string
  vatNumber: string
  status: 'active' | 'suspended'
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createSessionToken(session: B2BSession): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .setIssuedAt()
    .sign(SESSION_SECRET)
}

export async function verifySessionToken(token: string): Promise<B2BSession | null> {
  try {
    const { payload } = await jwtVerify(token, SESSION_SECRET)
    return payload as unknown as B2BSession
  } catch {
    return null
  }
}

export async function getServerSession(): Promise<B2BSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return null
  return verifySessionToken(token)
}

export const SESSION_COOKIE = {
  name: 'b2b_session',
  options: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 30,
    path: '/',
  },
}
```

- [ ] **Step 2: Typecheck**

```bash
cd b2b && npx tsc --noEmit
```

Se appaiono errori legati a `proMemberId` in altri file, li risolveremo nei task successivi. Per ora verifica solo che `auth.ts` stesso non abbia errori di sintassi.

- [ ] **Step 3: Commit**

```bash
cd b2b && git add src/lib/auth.ts
git commit -m "feat(b2b): aggiorna auth.ts — rimuove magic token, aggiunge bcrypt helpers"
```

---

## Task 4: Crea `/api/auth/login/route.ts`

**Files:**
- Create: `b2b/src/app/api/auth/login/route.ts`

**Interfaces:**
- Consumes:
  - `findB2BUserByEmail`, `createB2BUser`, `setB2BUserPassword` da `@/lib/db-auth`
  - `findProMemberByEmail` da `@/lib/db` (per gestire migrazione utenti esistenti)
  - `hashPassword`, `verifyPassword`, `createSessionToken`, `SESSION_COOKIE` da `@/lib/auth`
  - `sendWelcomeEmail`, `sendActivationNotification` da `@/lib/resend` (aggiunti nel Task 3)
  - `ensureB2BAuthTable` da `@/lib/db-auth`
- Produces:
  - `POST /api/auth/login` con body `{ step: 'check', email: string }` → `{ exists: boolean, needsPassword: boolean }`
  - `POST /api/auth/login` con body `{ step: 'auth', email: string, password: string, businessName?: string }` → setta cookie sessione, ritorna `{ ok: true, isNew: boolean }`

**Logica step 'auth':**
1. `b2b_auth` esiste con `password_hash` → login normale (verifica bcrypt)
2. `b2b_auth` esiste senza `password_hash` → utente migrato che imposta password per la prima volta (salva hash, nessuna welcome email, BCC Frank con nota "attivazione")
3. `b2b_auth` non esiste ma `pro_members` ha l'email → migrazione: crea record in `b2b_auth` + imposta password (BCC Frank con nota "attivazione primo accesso")
4. Nessuno dei due → nuova registrazione: crea `b2b_auth` + welcome email + BCC Frank

- [ ] **Step 1: Crea directory e file**

```bash
mkdir -p b2b/src/app/api/auth/login
```

- [ ] **Step 2: Scrivi `src/app/api/auth/login/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { ensureB2BAuthTable, findB2BUserByEmail, createB2BUser, setB2BUserPassword } from '@/lib/db-auth'
import { findProMemberByEmail } from '@/lib/db'
import { hashPassword, verifyPassword, createSessionToken, SESSION_COOKIE, type B2BSession } from '@/lib/auth'
import { sendWelcomeEmail, sendActivationNotification } from '@/lib/resend'

export async function POST(req: NextRequest) {
  await ensureB2BAuthTable()

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
```

- [ ] **Step 3: Typecheck**

```bash
cd b2b && npx tsc --noEmit
```

Output atteso: nessun errore (Task 3 - resend.ts - va eseguito prima di questo task).

- [ ] **Step 4: Commit**

```bash
cd b2b && git add src/app/api/auth/login/route.ts
git commit -m "feat(b2b): nuovo endpoint /api/auth/login (login+registrazione+migrazione)"
```

---

## Task 3: Aggiorna `src/lib/resend.ts`

**Files:**
- Modify: `b2b/src/lib/resend.ts`

**Interfaces:**
- Rimuove: `sendMagicLink`
- Aggiunge: `sendWelcomeEmail(email: string, businessName: string): Promise<void>`
- Aggiunge: `sendActivationNotification(email: string, businessName: string): Promise<void>`
- Mantiene invariato: `sendOrderConfirmation`

- [ ] **Step 1: Riscrivi `src/lib/resend.ts`**

```typescript
import { Resend } from 'resend'
import { formatPrice } from './pricing'

const FROM = 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
const FRANK_BCC = 'support.foolish@agentmail.to'
const CATALOG_URL = 'https://rivenditori.thefoolishbutcher.com/catalogo'

const getResend = () => new Resend(process.env.RESEND_API_KEY!)

export async function sendWelcomeEmail(email: string, businessName: string): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: email,
    bcc: [FRANK_BCC],
    subject: 'Benvenuto nell\'area rivenditori — The Foolish Butcher',
    html: `
      <p>Benvenuto nell'area rivenditori di The Foolish Butcher!</p>
      <p>Il tuo account per <strong>${businessName}</strong> è stato creato con successo.</p>
      <p>
        <a href="${CATALOG_URL}" style="background:#1c1c1c;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">
          Accedi al catalogo
        </a>
      </p>
      <p>Per qualsiasi necessità scrivici a <a href="mailto:ordini@thefoolishbutcher.com">ordini@thefoolishbutcher.com</a>.</p>
      <p>The Foolish Butcher</p>
    `,
  })
}

export async function sendActivationNotification(email: string, businessName: string): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: FRANK_BCC,
    subject: `Rivenditore attivato: ${businessName}`,
    html: `
      <p>Il rivenditore <strong>${businessName}</strong> (<code>${email}</code>) ha impostato la propria password e attivato l'accesso all'area rivenditori.</p>
    `,
  })
}

export async function sendOrderConfirmation(params: {
  email: string
  contactName: string
  orderNumber: string
  total: number
  paymentMethod: string
  lineItems: { name: string; qty: number; total: number }[]
}) {
  const itemsHtml = params.lineItems
    .map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${formatPrice(i.total)}</td></tr>`)
    .join('')

  const paymentNote = params.paymentMethod === 'bonifico'
    ? `<p><strong>Pagamento:</strong> Bonifico bancario. Riceverai le coordinate bancarie a breve via email.</p>`
    : `<p><strong>Pagamento:</strong> Carta di credito (Stripe). Il pagamento è stato confermato.</p>`

  await getResend().emails.send({
    from: FROM,
    to: params.email,
    bcc: ['boscaratoa@icloud.com', FRANK_BCC],
    subject: `Ordine ${params.orderNumber} confermato — The Foolish Butcher`,
    html: `
      <p>Ciao ${params.contactName || 'rivenditore'},</p>
      <p>Il tuo ordine <strong>${params.orderNumber}</strong> è stato ricevuto.</p>
      <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
        <thead><tr><th>Prodotto</th><th>Qtà</th><th>Totale</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p><strong>Totale ordine: ${formatPrice(params.total)}</strong> (IVA inclusa)</p>
      ${paymentNote}
      <p>Grazie,<br/>The Foolish Butcher</p>
    `,
  })
}
```

- [ ] **Step 2: Typecheck completo**

```bash
cd b2b && npx tsc --noEmit
```

Output atteso: nessun errore.

- [ ] **Step 3: Commit**

```bash
cd b2b && git add src/lib/resend.ts
git commit -m "feat(b2b): aggiorna resend.ts — sendWelcomeEmail, sendActivationNotification, rimuove sendMagicLink"
```

---

## Task 5: Riscrivi `src/app/login/page.tsx`

**Files:**
- Modify: `b2b/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/login` con step `check` e `auth`
- Produces: form progressivo in due step; redirect a `/catalogo?_login=1` (utente esistente) o `/catalogo?_register=1` (nuovo utente)

**UX flow:**
- Step 1: solo campo email + button "Continua"
- Click "Continua" → chiama `/api/auth/login` con `{ step: 'check', email }`
- Se `{ exists: true }` → Step 2a: mostra campo password, label "Accedi"
- Se `{ exists: false }` → Step 2b: mostra campo password + campo nome attività, label "Registrati e accedi"
- Submit Step 2 → chiama `/api/auth/login` con `{ step: 'auth', email, password, businessName? }`
- Se `isNew: true` → redirect `/catalogo?_register=1`
- Se `isNew: false` → redirect `/catalogo?_login=1`

- [ ] **Step 1: Riscrivi `src/app/login/page.tsx`**

```tsx
'use client'
import { useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'

const inputStyle: React.CSSProperties = {
  background: 'var(--background)',
  border: '1px solid var(--border)',
  borderRadius: '0.75rem',
  padding: '0.75rem 1rem',
  fontSize: '0.9rem',
  color: 'var(--foreground)',
  outline: 'none',
  width: '100%',
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--accent)',
  color: '#000',
  border: 'none',
  borderRadius: '0.75rem',
  padding: '0.75rem 1.5rem',
  fontSize: '0.875rem',
  fontWeight: 600,
  width: '100%',
  letterSpacing: '0.02em',
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={{
      background: 'rgba(192,57,43,0.1)',
      border: '1px solid rgba(192,57,43,0.3)',
      borderRadius: '0.5rem',
      padding: '0.75rem 1rem',
      marginBottom: '1.25rem',
      fontSize: '0.85rem',
      color: '#e57373',
    }}>
      {msg}
    </div>
  )
}

type UIStep = 'email' | 'login' | 'register'

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email o password non corretti.',
  account_suspended: 'Account sospeso. Contatta il supporto.',
  password_too_short: 'La password deve essere di almeno 6 caratteri.',
  business_name_required: 'Inserisci il nome della tua attività.',
  default: 'Si è verificato un errore. Riprova.',
}

function LoginForm() {
  const router = useRouter()
  const [uiStep, setUiStep] = useState<UIStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'check', email }),
      })
      const data = await res.json()
      setUiStep(data.exists ? 'login' : 'register')
    } catch {
      setError(ERROR_MESSAGES.default)
    } finally {
      setLoading(false)
    }
  }

  async function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const body: Record<string, string> = { step: 'auth', email, password }
      if (uiStep === 'register') body.businessName = businessName
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        router.replace(data.isNew ? '/catalogo?_register=1' : '/catalogo?_login=1')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(ERROR_MESSAGES[data?.error] ?? ERROR_MESSAGES.default)
      }
    } catch {
      setError(ERROR_MESSAGES.default)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h1 style={{ fontFamily: 'var(--font-cormorant)', fontWeight: 600, fontStyle: 'italic', fontSize: '2rem', color: 'var(--accent)', marginBottom: '0.25rem' }}>
            The Foolish Butcher
          </h1>
          <p style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.15em', color: 'var(--muted-fg)' }}>
            Portale Rivenditori
          </p>
        </div>

        <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '1rem', padding: '2rem' }}>

          {error && <ErrorBox msg={error} />}

          {uiStep === 'email' && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Accedi o registrati</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                Inserisci la tua email per continuare.
              </p>
              <form onSubmit={handleEmailSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="email"
                  required
                  placeholder="La tua email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ ...primaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Attendere…' : 'Continua'}
                </button>
              </form>
            </>
          )}

          {uiStep === 'login' && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Bentornato</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                {email} — <button onClick={() => { setUiStep('email'); setError(null) }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>Cambia</button>
              </p>
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ ...primaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Attendere…' : 'Accedi'}
                </button>
              </form>
            </>
          )}

          {uiStep === 'register' && (
            <>
              <h2 style={{ fontSize: '1rem', fontWeight: 500, marginBottom: '0.375rem' }}>Crea il tuo accesso</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--muted-fg)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
                {email} — <button onClick={() => { setUiStep('email'); setError(null) }} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>Cambia</button>
              </p>
              <form onSubmit={handleAuthSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <input
                  type="text"
                  required
                  placeholder="Nome della tua attività"
                  value={businessName}
                  onChange={e => setBusinessName(e.target.value)}
                  style={inputStyle}
                  autoFocus
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Scegli una password (min. 6 caratteri)"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={inputStyle}
                />
                <button
                  type="submit"
                  disabled={loading}
                  style={{ ...primaryBtn, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1 }}
                >
                  {loading ? 'Attendere…' : 'Registrati e accedi'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--muted-fg)', opacity: 0.6 }}>
          Accesso riservato ai rivenditori autorizzati
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
cd b2b && npx tsc --noEmit
```

Output atteso: nessun errore.

- [ ] **Step 3: Commit**

```bash
cd b2b && git add src/app/login/page.tsx
git commit -m "feat(b2b): riscrivi login page — form progressivo email+password auto-registrazione"
```

---

## Task 6: Aggiorna `src/components/LoginTracker.tsx`

**Files:**
- Modify: `b2b/src/components/LoginTracker.tsx`

**Interfaces:**
- Mantiene: tracking `reseller_login` su `?_login=1`
- Aggiunge: tracking `reseller_register` su `?_register=1`

- [ ] **Step 1: Aggiorna `src/components/LoginTracker.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, unknown>) => void }
  }
}

export function LoginTracker({ email }: { email: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const param = searchParams.get('_login') === '1'
      ? 'login'
      : searchParams.get('_register') === '1'
        ? 'register'
        : null
    if (!param) return

    if (param === 'login') window.umami?.track('reseller_login', { email })
    if (param === 'register') window.umami?.track('reseller_register', { email })

    router.replace('/catalogo')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
```

- [ ] **Step 2: Typecheck**

```bash
cd b2b && npx tsc --noEmit
```

Output atteso: nessun errore.

- [ ] **Step 3: Commit**

```bash
cd b2b && git add src/components/LoginTracker.tsx
git commit -m "feat(b2b): LoginTracker aggiunge tracking reseller_register"
```

---

## Task 7: Rimuovi i file del vecchio sistema

**Files:**
- Delete: `b2b/src/app/api/auth/magic-link/route.ts`
- Delete: `b2b/src/app/api/auth/verify/route.ts`
- Delete: `b2b/src/app/auth/verify/page.tsx`
- Delete: `b2b/src/app/api/auth/classic-login/route.ts`

- [ ] **Step 1: Elimina i file**

```bash
cd b2b
rm src/app/api/auth/magic-link/route.ts
rm src/app/api/auth/verify/route.ts
rm src/app/api/auth/classic-login/route.ts
rm src/app/auth/verify/page.tsx
```

Rimuovi le directory vuote se rimangono:

```bash
rmdir src/app/api/auth/magic-link 2>/dev/null || true
rmdir src/app/api/auth/verify 2>/dev/null || true
rmdir src/app/api/auth/classic-login 2>/dev/null || true
rmdir src/app/auth/verify 2>/dev/null || true
rmdir src/app/auth 2>/dev/null || true
```

- [ ] **Step 2: Typecheck finale**

```bash
cd b2b && npx tsc --noEmit
```

Output atteso: nessun errore. Se appaiono errori legati a import di `sendMagicLink` o `createMagicToken` da qualche file rimasto, cercare e rimuovere gli import.

- [ ] **Step 3: Verifica che non ci siano import residui**

```bash
grep -rn "magic-link\|magic_link\|magicLink\|createMagicToken\|verifyMagicToken\|sendMagicLink\|classic-login\|authenticateClassicLogin" b2b/src/ 2>/dev/null
```

Output atteso: nessuna riga.

- [ ] **Step 4: Commit**

```bash
cd b2b && git add -A
git commit -m "chore(b2b): rimuove magic link e classic login — sistema legacy eliminato"
```

---

## Task 8: Build di verifica e push

- [ ] **Step 1: Build completo**

```bash
cd b2b && npm run build 2>&1 | tail -20
```

Output atteso: `✓ Compiled successfully` o simile, senza errori di build.

- [ ] **Step 2: Typecheck CMS (verifica nessun impatto)**

```bash
cd /home/ab/dev/foolish-storefront && cd storefront && npx tsc --noEmit && cd ../cms && npx tsc --noEmit
```

Output atteso: nessun errore.

- [ ] **Step 3: Push unico**

```bash
cd /home/ab/dev/foolish-storefront && git push origin main
```

Railway rideploya automaticamente. Dopo il deploy (1-2 minuti) verifica su `https://rivenditori.thefoolishbutcher.com/login`.

---

## Verifica manuale post-deploy

- [ ] Apri `https://rivenditori.thefoolishbutcher.com/login` — vedi form con solo campo email
- [ ] Inserisci un'email nuova → clicca Continua → appaiono campo nome attività + password
- [ ] Completa la registrazione → redirect a catalogo → Umami traccia `reseller_register`
- [ ] Logout e login con la stessa email → step 2 mostra solo password → `reseller_login` trackato
- [ ] Prova un'email di un vecchio pro_member (es. uno esistente nel DB) → sistema lo riconosce come migrazione → chiede di impostare password
- [ ] Verifica su Resend dashboard che la welcome email sia arrivata (con BCC a Frank)
