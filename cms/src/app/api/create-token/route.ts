import { NextRequest, NextResponse } from 'next/server'
import payload from 'payload'

const ADMIN_SECRET = process.env.ADMIN_API_SECRET || 'CHANGE_ME'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('x-admin-secret')
  if (authHeader !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, apiKey } = await req.json()
  if (!email || !apiKey) {
    return NextResponse.json({ error: 'email and apiKey required' }, { status: 400 })
  }

  await payload.init({
    config: (await import('../payload.config.js')).default,
  })

  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
  })

  if (existing.docs.length > 0) {
    await payload.update({
      collection: 'users',
      id: existing.docs[0].id,
      data: { enableAPIKey: true, apiKey },
    })
    return NextResponse.json({ ok: true, action: 'updated' })
  }

  await payload.create({
    collection: 'users',
    data: { email, password: 'DO_NOT_USE_' + Date.now(), enableAPIKey: true, apiKey },
  })
  return NextResponse.json({ ok: true, action: 'created' })
}
