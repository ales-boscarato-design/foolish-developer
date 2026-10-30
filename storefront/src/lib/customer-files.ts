/**
 * Download dei file cliente: un documento collegato a un cliente e' privato e i suoi byte
 * non devono essere serviti da un URL pubblico. Lo storefront e' l'unico che puo' chiederli
 * al CMS, presentando il secret fidato, e solo dopo aver verificato che la sessione
 * appartenga al cliente proprietario.
 */

export type CustomerFileRelation =
  | number
  | string
  | { id?: number | string; email?: string | null }
  | null
  | undefined

export interface CustomerFileDoc {
  id: number | string
  title?: string
  active?: boolean
  customer?: CustomerFileRelation
  file?: { url?: string | null; filename?: string | null; filesize?: number | null } | number | string | null
}

export type LoadCustomerFileResult =
  | {
      ok: true
      body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array | null
      contentType: string
      filename: string
      filesize: number | null
    }
  | { ok: false; status: 401 | 404 | 502 }

export interface LoadCustomerFileArgs {
  cmsUrl: string
  secret: string
  fileId: string
  sessionEmail: string | null | undefined
  fetchImpl?: typeof fetch
}

/**
 * Il file e' del cliente proprietario?
 * - `customer` vuoto/assente: il record e' per tutti i clienti registrati (stessa regola
 *   del filtro della pagina account).
 * - `customer` valorizzato: serve l'email del proprietario. Una relazione non risolta
 *   (id numerico) non permette di dimostrare la proprieta' -> nega (fail-closed).
 */
export function ownsCustomerFile(customer: CustomerFileRelation, sessionEmail: string | null | undefined): boolean {
  if (!sessionEmail) return false
  if (customer === null || customer === undefined || customer === '') return true
  if (typeof customer === 'object') {
    const email = customer.email
    return typeof email === 'string' && email.length > 0 && email.toLowerCase() === sessionEmail.toLowerCase()
  }
  return false
}

function mediaFilename(file: CustomerFileDoc['file']): string | null {
  if (!file || typeof file !== 'object') return null
  if (typeof file.filename === 'string' && file.filename.length > 0) return file.filename
  const url = typeof file.url === 'string' ? file.url : ''
  const match = url.match(/\/api\/media\/file\/([^/?#]+)$/)
  return match ? decodeURIComponent(match[1]) : null
}

export async function loadCustomerFile({
  cmsUrl,
  secret,
  fileId,
  sessionEmail,
  fetchImpl = fetch,
}: LoadCustomerFileArgs): Promise<LoadCustomerFileResult> {
  if (!sessionEmail) return { ok: false, status: 401 }

  const base = cmsUrl.replace(/\/+$/, '')
  const headers = { 'x-storefront-secret': secret }

  let docRes: Response
  try {
    docRes = await fetchImpl(`${base}/api/customer-files/${encodeURIComponent(fileId)}?depth=1`, {
      headers,
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 502 }
  }
  if (docRes.status === 404) return { ok: false, status: 404 }
  if (!docRes.ok) return { ok: false, status: 502 }

  let doc: CustomerFileDoc
  try {
    doc = (await docRes.json()) as CustomerFileDoc
  } catch {
    return { ok: false, status: 502 }
  }
  if (!doc || doc.id === undefined || doc.id === null) return { ok: false, status: 404 }
  if (doc.active === false) return { ok: false, status: 404 }
  if (!ownsCustomerFile(doc.customer, sessionEmail)) return { ok: false, status: 404 }

  const filename = mediaFilename(doc.file)
  if (!filename) return { ok: false, status: 502 }

  let fileRes: Response
  try {
    fileRes = await fetchImpl(`${base}/api/media/file/${encodeURIComponent(filename)}`, {
      headers,
      cache: 'no-store',
    })
  } catch {
    return { ok: false, status: 502 }
  }
  if (!fileRes.ok) return { ok: false, status: 502 }

  const contentType = fileRes.headers.get('content-type') ?? 'application/octet-stream'
  const declaredLength = Number(fileRes.headers.get('content-length'))
  const filesize =
    Number.isFinite(declaredLength) && declaredLength > 0
      ? declaredLength
      : typeof (doc.file as { filesize?: number })?.filesize === 'number'
        ? (doc.file as { filesize: number }).filesize
        : null

  return {
    ok: true,
    body: fileRes.body as ReadableStream<Uint8Array> | null,
    contentType,
    filename,
    filesize,
  }
}

/** Nome file sicuro per l'header Content-Disposition: niente virgolette, CR o LF. */
export function safeFilenameForHeader(filename: string): string {
  return filename.replace(/[\r\n"]/g, '_').replace(/[^\x20-\x7e]/g, '_')
}
