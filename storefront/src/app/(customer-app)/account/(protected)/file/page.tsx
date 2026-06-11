import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getWishlist } from '@/lib/account-db'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import { WishlistItemActions } from './_components/WishlistItem'
import { cmsImageUrl } from '@/lib/cms'

interface CustomerFile {
  id: string
  title: string
  fileType: string
  active: boolean
  file?: { url?: string; filename?: string; filesize?: number }
  customer?: { email?: string } | null
  description?: string
}

export default async function FilePage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const [wishlist, locale] = await Promise.all([
    getWishlist(session.email),
    getAccountLocale(),
  ])
  const t = getT(locale)

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const filesRes = await fetch(
    `${cmsUrl}/api/customer-files?where[active][equals]=true&limit=50&depth=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! }, cache: 'no-store' }
  )
  const filesData = filesRes.ok ? await filesRes.json() : { docs: [] }
  const allFiles: CustomerFile[] = filesData.docs ?? []
  const myFiles = allFiles.filter((f) => !f.customer || f.customer?.email === session.email)

  const FILE_ICON: Record<string, string> = { guide: '📄', video: '🎬', resource: '📎' }

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>{t('files_title')}</div>
        <div style={{ fontSize: '18px', fontWeight: 300 }}>{t('your_resources')}</div>
      </div>

      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        {t('files')} ({myFiles.length})
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
        {myFiles.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>{t('no_files')}</div>
        )}
        {myFiles.map((file) => {
          const fullUrl = cmsImageUrl(file.file?.url)
          const ext = file.file?.filename?.split('.').pop()?.toUpperCase() ?? ''
          const sizeMb = file.file?.filesize ? (file.file.filesize / 1024 / 1024).toFixed(1) : null
          return (
            <a
              key={file.id}
              href={fullUrl}
              download
              target="_blank"
              rel="noopener noreferrer"
              style={{ background: '#111', border: '1px solid #1e1e1e', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '10px', textDecoration: 'none' }}
            >
              <div style={{ width: '40px', height: '40px', background: '#1a1a1a', borderRadius: '6px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: '1px' }}>
                <div style={{ fontSize: '16px', lineHeight: 1 }}>{FILE_ICON[file.fileType] ?? '📎'}</div>
                {ext && <div style={{ fontSize: '8px', color: '#555', letterSpacing: '0.05em' }}>{ext}</div>}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', color: '#fff', marginBottom: '2px' }}>{file.title}</div>
                {sizeMb && (
                  <div style={{ fontSize: '10px', color: '#555' }}>{sizeMb} MB</div>
                )}
              </div>
              <div style={{ color: '#c9a96e', fontSize: '18px', flexShrink: 0 }}>↓</div>
            </a>
          )
        })}
      </div>

      <div style={{ fontSize: '10px', color: '#555', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>
        {t('wishlist')} ({wishlist.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {wishlist.length === 0 && (
          <div style={{ color: '#555', fontSize: '12px' }}>{t('no_wishlist')}</div>
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
              {t('buy')}
            </a>
            <WishlistItemActions slug={item.product_slug} name={item.product_name} removeLabel={t('remove')} />
          </div>
        ))}
      </div>
    </div>
  )
}
