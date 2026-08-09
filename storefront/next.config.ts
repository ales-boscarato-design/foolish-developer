import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')
const umamiUrl = process.env.NEXT_PUBLIC_UMAMI_URL ?? 'https://umami-production-1ebb.up.railway.app'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' https://js.stripe.com ${umamiUrl}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.stripe.com https://*.railway.app",
      "font-src 'self'",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      `connect-src 'self' https://api.stripe.com https://t.me ${umamiUrl}`,
    ].join('; '),
  },
]

const LOCALES = ['it', 'en', 'fr', 'es', 'de']

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ['thefoolishbutcher.com', 'www.thefoolishbutcher.com'],
    },
  },
  // Le immagini CMS sono proxiate via /cms-media/* (Route Handler) — path locale, no remotePatterns necessari
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '3001' },
    ],
  },
  async redirects() {
    const frankRedirects = LOCALES.map((locale) => ({
      source: `/${locale}/frank`,
      destination: `/${locale}/sebo`,
      permanent: true,
    }))
    const masterPackRedirects = LOCALES.map((locale) => ({
      source: `/${locale}/prodotto/master-pack-20-fogli`,
      destination: `/${locale}/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl`,
      permanent: true,
    }))
    // Old WooCommerce / WordPress URLs
    const legacyRedirects = [
      // Shop / product listings
      { source: '/shop',         destination: '/it/',      permanent: true },
      { source: '/it/products',  destination: '/it/',      permanent: true },
      { source: '/en/products',  destination: '/en/',      permanent: true },
      // Virtual WooCommerce product (spedizione gratuita, non reale)
      { source: '/it/product/free-shipping-ita', destination: '/it/', permanent: true },
      { source: '/en/product/free-shipping-ita', destination: '/en/', permanent: true },
      // Contact page
      { source: '/en/contact',       destination: '/en/contatti', permanent: true },
      { source: '/en/pages/contact', destination: '/en/contatti', permanent: true },
      { source: '/it/contact',       destination: '/it/contatti', permanent: true },
      { source: '/de/contact',       destination: '/de/contatti', permanent: true },
      { source: '/fr/contact',       destination: '/fr/contatti', permanent: true },
      { source: '/es/contact',       destination: '/es/contatti', permanent: true },
      // About / chi siamo (non esiste nel nuovo sito)
      { source: '/en/about', destination: '/en/', permanent: true },
      { source: '/it/about', destination: '/it/', permanent: true },
      // Legacy Shopify collections (no locale prefix on old Shopify store)
      { source: '/collections/:slug*', destination: '/it/', permanent: true },
      // Legacy Shopify product URLs → new prodotto routes
      { source: '/products/duoskin',  destination: '/it/prodotto/t-sheet-duoskin', permanent: true },
      { source: '/products/:slug',    destination: '/it/', permanent: true },
      // Legacy Shopify blog
      { source: '/blogs/:path*', destination: '/it/', permanent: true },
      // Legacy Shopify pages
      { source: '/pages/:slug', destination: '/it/', permanent: true },
      // Legacy product lines (old landing pages)
      ...LOCALES.map((locale) => ({
        source: `/${locale}/duoskin`,
        destination: `/${locale}/prodotto/t-sheet-duoskin`,
        permanent: true,
      })),
      ...LOCALES.map((locale) => ({
        source: `/${locale}/woodskin`,
        destination: `/${locale}/`,
        permanent: true,
      })),
    ]

    // Old WooCommerce product-category URLs
    const productCategoryRedirects = LOCALES.flatMap((locale) => [
      {
        source: `/${locale}/product-category/negozio/tattoo`,
        destination: `/${locale}/tattoo`,
        permanent: true,
      },
      {
        source: `/${locale}/product-category/negozio/pmu`,
        destination: `/${locale}/pmu`,
        permanent: true,
      },
      {
        source: `/${locale}/product-category/:path*`,
        destination: `/${locale}/`,
        permanent: true,
      },
    ])

    return [...frankRedirects, ...masterPackRedirects, ...legacyRedirects, ...productCategoryRedirects]
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
