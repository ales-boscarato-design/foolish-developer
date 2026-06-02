import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'http://localhost:3001'

/**
 * Proxy CMS media through /cms-media/* so /_next/image sees a same-origin URL.
 *
 * We use a Route Handler (not a rewrite) because Next.js rewrites decode path
 * segments before interpolating them into the destination URL, which turns
 * TATTOO%20SKIN%20(2).png into "TATTOO SKIN (2).png" with literal spaces and
 * breaks the HTTP request to the CMS.
 *
 * encodeURI preserves characters that are legal in URL paths (like parentheses)
 * while safely encoding spaces and other chars that would break the request.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params
  // params.path segments are URL-decoded by Next.js; re-encode for CMS URL.
  // encodeURI (not encodeURIComponent) preserves ( ) and other path-safe chars.
  const filename = path.map((s) => encodeURI(s)).join('/')
  const upstream = `${CMS_URL}/api/media/file/${filename}`

  const res = await fetch(upstream)
  if (!res.ok) return new NextResponse(null, { status: res.status })

  const headers = new Headers()
  const ct = res.headers.get('content-type')
  if (ct) headers.set('content-type', ct)
  headers.set('cache-control', 'public, max-age=31536000, immutable')

  return new NextResponse(res.body, { status: 200, headers })
}
