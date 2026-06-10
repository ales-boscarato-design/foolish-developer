import { NextRequest, NextResponse } from 'next/server'
import { createMagicToken } from '@/lib/account-auth'
import sql from '@/lib/db'

const SUPPORTED_LOCALES = ['it', 'en', 'de', 'fr', 'es']

function detectLocale(req: NextRequest): string {
  const accept = req.headers.get('accept-language') ?? ''
  for (const part of accept.split(',')) {
    const lang = part.split(';')[0]?.trim().slice(0, 2).toLowerCase() ?? ''
    if (SUPPORTED_LOCALES.includes(lang)) return lang
  }
  return 'it'
}

export async function POST(req: NextRequest) {
  let email: string
  try {
    const body = await req.json()
    email = (body.email ?? '').toString().toLowerCase().trim()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
  }

  // Rate limit: max 3 magic link emails per 10 min per email
  const recent = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM marketing.email_log
    WHERE email = ${email}
      AND type = 'magic_link'
      AND sent_at > NOW() - INTERVAL '10 minutes'
  `
  if (parseInt(recent[0]?.count ?? '0') >= 3) {
    // Silent: don't reveal rate limit to avoid enumeration
    return NextResponse.json({ ok: true })
  }

  const detectedLocale = detectLocale(req)

  // Upsert subscriber — create if not exists so anyone can register
  const rows = await sql<{ email: string; name: string | null; locale: string }[]>`
    INSERT INTO marketing.subscribers (email, status, locale)
    VALUES (${email}, 'active', ${detectedLocale})
    ON CONFLICT (email) DO UPDATE SET status = CASE
      WHEN marketing.subscribers.status = 'unsubscribed' THEN 'active'
      ELSE marketing.subscribers.status
    END
    RETURNING email, name, locale
  `
  if (!rows.length) return NextResponse.json({ ok: true })

  const subscriber = rows[0]!
  const token = await createMagicToken(subscriber.email)
  const loginUrl = `${process.env.STOREFRONT_URL}/account/auth?token=${token}`
  const isIt = subscriber.locale === 'it'

  const html = `
    <div style="font-family:monospace;max-width:480px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;">
      <div style="font-size:11px;letter-spacing:2px;color:#555;text-transform:uppercase;margin-bottom:24px;">The Foolish Butcher</div>
      <p style="color:#aaa;margin-bottom:16px;">${isIt ? `Ciao${subscriber.name ? ` ${subscriber.name}` : ''},` : `Hi${subscriber.name ? ` ${subscriber.name}` : ''},`}</p>
      <p style="color:#aaa;margin-bottom:24px;">${isIt ? 'Clicca per accedere alla tua area personale. Il link scade in 15 minuti.' : 'Click to access your personal area. The link expires in 15 minutes.'}</p>
      <a href="${loginUrl}" style="display:inline-block;background:#c9a96e;color:#000;padding:12px 24px;text-decoration:none;font-weight:bold;font-size:13px;border-radius:4px;">${isIt ? 'Accedi' : 'Sign in'}</a>
      <p style="color:#444;font-size:11px;margin-top:32px;">${isIt ? 'Se non hai richiesto questo link, ignora questa email.' : "If you didn't request this, ignore this email."}</p>
    </div>
  `

  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM ?? 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>',
        to: subscriber.email,
        subject: isIt ? 'Accedi alla tua area personale' : 'Sign in to your account',
        html,
      }),
    })
    const data = await res.json().catch(() => ({}))
    await sql`
      INSERT INTO marketing.email_log (email, type, resend_id)
      VALUES (${subscriber.email}, 'magic_link', ${(data as { id?: string }).id ?? null})
    `
  }

  return NextResponse.json({ ok: true })
}
