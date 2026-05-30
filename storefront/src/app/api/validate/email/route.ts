import { NextRequest, NextResponse } from 'next/server'
import dns from 'dns/promises'

export const runtime = 'nodejs'

// Known disposable email domains (minimal blocklist — not exhaustive)
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org',
  'guerrillamail.biz', 'guerrillamail.de', 'guerrillamail.info', 'sharklasers.com',
  'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'spam4.me',
  'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc',
  'nomail.xl.cx', 'mega.zik.dj', 'speed.1s.fr', 'courriel.fr.nf',
  'trashmail.com', 'trashmail.me', 'trashmail.net', 'trashmail.at',
  'trashmail.io', 'trashmail.org', 'trashmail.xyz',
  'tempmail.com', 'temp-mail.org', 'throwam.com', 'dispostable.com',
  'mailnull.com', 'maildrop.cc', 'discard.email', 'spamgourmet.com',
  '10minutemail.com', '10minutemail.net', '10minutemail.org',
  'fakeinbox.com', 'filzmail.com', 'sharklasers.com', 'spamherelots.com',
])

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ valid: false })
    }

    const parts = email.split('@')
    if (parts.length !== 2) return NextResponse.json({ valid: false })

    const domain = parts[1].toLowerCase()

    // Block known disposable domains
    if (DISPOSABLE.has(domain)) {
      return NextResponse.json({ valid: false })
    }

    // Check MX records — if none exist, domain can't receive email
    try {
      const records = await dns.resolveMx(domain)
      return NextResponse.json({ valid: records.length > 0 })
    } catch {
      // resolveMx throws on NXDOMAIN or NODATA — domain doesn't exist or has no MX
      return NextResponse.json({ valid: false })
    }
  } catch {
    // Fail open — never block a payment on our own API error
    return NextResponse.json({ valid: true })
  }
}
