import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getWishlist } from '@/lib/account-db'
import { WishlistItemActions } from './_components/WishlistItem'

interface CustomerFile {
  id: string
  title: string
  fileType: string
  active: boolean
  file?: { url?: string; filename?: string; filesize?: number }
  customer?: { email?: string } | null
}

export default async function FilePage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL

  // Fetch files for this customer (customer = email OR customer = null)
  const filesRes = await fetch(
    `${cmsUrl}/api/customer-files?where[active][equals]=true&limit=50&depth=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const filesData = filesRes.ok ? await filesRes.json() : { docs: [] }
  const allFiles: CustomerFile[] = filesData.docs ?? []

  // Filter: show files where customer is null (global) or customer.email === session.email
  const myFiles = allFiles.filter((f) => !f.customer || f.customer?.email === session.email)

  const wishlist = await getWishlist(session.email)

  const FILE_ICON: Record<string, string> = { guide: '📄', video: '🎬', resource: '📎' }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>File & Wishlist</div>
        <div style={{ fontSize: '18px', fontWeight: 300 }}>Le tue risorse</div>
      </div>

      {/* File section */}
      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        File ({myFiles.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
        {myFiles.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>Nessun file disponibile al momento.</div>
        )}
        {myFiles.map((file) => {
          const fileUrl = file.file?.url
          const mediaBase = process.env.NEXT_PUBLIC_CMS_URL ?? ''
          const fullUrl = fileUrl?.startsWith('http') ? fileUrl : `${mediaBase}${fileUrl}`
          return (
            <a
              key={file.id}
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
            >
              <div style={{ width: '36px', height: '36px', background: '#1a1a1a', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                {FILE_ICON[file.fileType] ?? '📎'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', color: '#fff', marginBottom: '2px' }}>{file.title}</div>
                {file.file?.filesize && (
                  <div style={{ fontSize: '10px', color: '#555' }}>
                    {(file.file.filesize / 1024 / 1024).toFixed(1)} MB
                  </div>
                )}
              </div>
              <div style={{ color: '#c9a96e', fontSize: '14px' }}>↓</div>
            </a>
          )
        })}
      </div>

      {/* Wishlist section */}
      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        Salvati ({wishlist.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {wishlist.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>Nessun prodotto salvato. Usa il bottone &quot;Salva&quot; sui prodotti.</div>
        )}
        {wishlist.map((item) => (
          <div key={item.id} style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', color: '#fff', marginBottom: '2px' }}>{item.product_name}</div>
              {item.product_price && (
                <div style={{ fontSize: '10px', color: '#555' }}>€{item.product_price.toFixed(2)}</div>
              )}
            </div>
            <a
              href={`/prodotti/${item.product_slug}`}
              style={{ background: '#c9a96e', color: '#000', fontSize: '10px', padding: '5px 10px', borderRadius: '4px', fontWeight: 600, textDecoration: 'none' }}
            >
              Acquista
            </a>
            <WishlistItemActions slug={item.product_slug} name={item.product_name} />
          </div>
        ))}
      </div>
    </div>
  )
}
