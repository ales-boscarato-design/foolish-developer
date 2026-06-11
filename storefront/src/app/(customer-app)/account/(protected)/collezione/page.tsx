import { redirect } from 'next/navigation'
import { getSession } from '@/lib/account-auth'
import { getAccountLocale, getT } from '@/lib/account-i18n'
import { getActiveCustomerOffer } from '@/lib/account-db'
import { getProductBySlug, cmsImageUrl } from '@/lib/cms'
import Link from 'next/link'
import { OfferCountdown } from './_components/OfferCountdown'
import { CopyCode } from './_components/CopyCode'

export default async function CollezionePage() {
  const session = await getSession()
  if (!session) redirect('/account/login')

  const locale = await getAccountLocale()
  const t = getT(locale)

  const offer = await getActiveCustomerOffer(session.email)
  let product = null
  if (offer) {
    try { product = await getProductBySlug(offer.product_slug, locale) } catch { /* CMS unavailable */ }
  }

  if (!offer || !product) {
    return (
      <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
        <div style={{ marginBottom: '16px', paddingTop: '8px' }}>
          <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
            {t('your_collection')}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 300 }}>{t('your_collection')}</div>
        </div>
        <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '60px 0', lineHeight: 1.6 }}>
          {t('sheets_appear')}
        </div>
      </div>
    )
  }

  const img = cmsImageUrl(product.images[0]?.image?.url)
  const productUrl = `/${locale}/prodotto/${product.slug}`

  return (
    <div style={{ padding: '16px', fontFamily: 'monospace', color: '#fff' }}>
      <div style={{ marginBottom: '20px', paddingTop: '8px' }}>
        <div style={{ fontSize: '10px', letterSpacing: '2px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>
          {t('your_collection')}
        </div>
        <div style={{ fontSize: '18px', fontWeight: 300 }}>Offerta riservata</div>
      </div>

      {/* Offer card */}
      <div style={{ background: '#111', border: '1px solid #c9a96e44', borderRadius: '10px', overflow: 'hidden' }}>

        {/* Product image */}
        <Link href={productUrl} style={{ display: 'block', textDecoration: 'none' }}>
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={product.name} style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }} />
          ) : (
            <div style={{ width: '100%', aspectRatio: '16/9', background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', color: '#333' }}>
              🧴
            </div>
          )}
        </Link>

        <div style={{ padding: '16px' }}>
          {/* Badge */}
          <div style={{ display: 'inline-block', background: '#c9a96e22', color: '#c9a96e', fontSize: '10px', fontWeight: 600, padding: '3px 10px', borderRadius: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '10px' }}>
            Solo per te — {offer.discount_percent}% di sconto
          </div>

          {/* Product name */}
          <Link href={productUrl} style={{ textDecoration: 'none' }}>
            <div style={{ fontSize: '16px', fontWeight: 500, color: '#fff', marginBottom: '6px' }}>{product.name}</div>
          </Link>

          {/* Price with discount */}
          {product.basePrice > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: '#c9a96e' }}>
                €{(product.basePrice * (1 - offer.discount_percent / 100)).toFixed(2)}
              </span>
              <span style={{ fontSize: '13px', color: '#555', textDecoration: 'line-through' }}>
                €{product.basePrice.toFixed(2)}
              </span>
            </div>
          )}

          {/* Promo code */}
          <div style={{ fontSize: '11px', color: '#555', marginBottom: '6px' }}>Usa questo codice al checkout:</div>
          <div style={{ marginBottom: '14px' }}>
            <CopyCode code={offer.promo_code} />
          </div>

          {/* Countdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}>
            <div style={{ width: '6px', height: '6px', background: '#c9a96e', borderRadius: '50%' }} />
            <div style={{ fontSize: '11px', color: '#888' }}>
              Scade tra: <OfferCountdown expiresAt={offer.expires_at.toISOString()} />
            </div>
          </div>

          {/* CTA */}
          <Link
            href={productUrl}
            style={{ display: 'block', background: '#c9a96e', color: '#000', textAlign: 'center', padding: '12px', borderRadius: '6px', fontSize: '13px', fontWeight: 700, textDecoration: 'none', letterSpacing: '0.02em' }}
          >
            Scopri il prodotto →
          </Link>
        </div>
      </div>
    </div>
  )
}
