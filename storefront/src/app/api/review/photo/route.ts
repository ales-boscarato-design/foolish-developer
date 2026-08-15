import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

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

  const cmsSecret = process.env.PAYLOAD_API_SECRET
  if (!cmsSecret) {
    console.error('[review/photo] PAYLOAD_API_SECRET is not configured')
    return NextResponse.json({ error: 'Upload unavailable' }, { status: 503 })
  }

  const upstream = new FormData()
  upstream.append('file', file)
  const res = await fetch(`${CMS_URL}/api/media`, {
    method: 'POST',
    headers: { 'x-storefront-secret': cmsSecret },
    body: upstream,
  })
  if (!res.ok) {
    console.error(`[review/photo] CMS upload failed with HTTP ${res.status}`)
    return NextResponse.json({ error: 'CMS upload failed' }, { status: 502 })
  }
  const data = await res.json()
  const url: string = data.doc?.url ?? data.url ?? ''
  return NextResponse.json({ url })
}
