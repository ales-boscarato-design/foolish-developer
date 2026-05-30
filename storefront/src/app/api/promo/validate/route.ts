import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Env var format: '{"FREESHIP":"free_shipping","WELCOME10":"percent_10"}'
function getCodes(): Record<string, string> {
  try {
    return JSON.parse(process.env.PROMO_CODES || '{}')
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest) {
  const { code } = await req.json()
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ valid: false })
  }

  const codes = getCodes()
  const type = codes[code.toUpperCase().trim()]

  if (!type) {
    return NextResponse.json({ valid: false })
  }

  return NextResponse.json({ valid: true, type })
}
