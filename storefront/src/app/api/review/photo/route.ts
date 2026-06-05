import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

let cmsJwt: string | null = null
let cmsJwtExpiry = 0

async function getCmsJwt(): Promise<string> {
  if (cmsJwt && Date.now() < cmsJwtExpiry) return cmsJwt
  const res = await fetch(`${CMS_URL}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.CMS_ADMIN_EMAIL,
      password: process.env.CMS_ADMIN_PASSWORD,
    }),
  })
  if (!res.ok) throw new Error(`CMS login failed: ${res.status}`)
  const data = await res.json()
  cmsJwt = data.token as string
  cmsJwtExpiry = Date.now() + 2 * 60 * 60 * 1000
  return cmsJwt!
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })
  }

  const jwt = await getCmsJwt()

  const upstream = new FormData()
  upstream.append('file', file)
  const res = await fetch(`${CMS_URL}/api/media`, {
    method: 'POST',
    headers: { Authorization: `JWT ${jwt}` },
    body: upstream,
  })
  if (!res.ok) {
    const err = await res.text()
    return NextResponse.json({ error: `CMS upload failed: ${err}` }, { status: 500 })
  }
  const data = await res.json()
  const url: string = data.doc?.url ?? data.url ?? ''
  return NextResponse.json({ url })
}
