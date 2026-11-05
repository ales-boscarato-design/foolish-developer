import { NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { loadCustomerFile, safeFilenameForHeader } from '@/lib/customer-files'

export const dynamic = 'force-dynamic'

/**
 * Download di un file cliente. I documenti con `customer` valorizzato hanno i byte
 * privati sul CMS: qui si verifica la sessione e la proprieta' prima di chiedere il file
 * al CMS con il secret dello storefront. La risposta non e' mai memorizzabile in cache
 * pubblica.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const secret = process.env.PAYLOAD_API_SECRET
  if (!cmsUrl || !secret) {
    console.error('[account/files] CMS non configurato')
    return NextResponse.json({ error: 'unavailable' }, { status: 502 })
  }

  const result = await loadCustomerFile({
    cmsUrl,
    secret,
    fileId: id,
    sessionEmail: session.email,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.status === 404 ? 'not_found' : 'unavailable' }, {
      status: result.status,
    })
  }

  const headers = new Headers({
    'content-type': result.contentType,
    'content-disposition': `attachment; filename="${safeFilenameForHeader(result.filename)}"`,
    'cache-control': 'private, no-store',
    'x-robots-tag': 'noindex',
  })
  if (result.filesize !== null) headers.set('content-length', String(result.filesize))

  return new NextResponse(result.body as BodyInit | null, { status: 200, headers })
}
