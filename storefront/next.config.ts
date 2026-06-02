import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://umami-production-8b53.up.railway.app",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.stripe.com https://*.railway.app",
      "font-src 'self'",
      "frame-src https://js.stripe.com https://hooks.stripe.com",
      "connect-src 'self' https://api.stripe.com https://t.me https://umami-production-8b53.up.railway.app",
    ].join('; '),
  },
]

const LOCALES = ['it', 'en', 'fr', 'es', 'de']


const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'http://localhost:3001'

const nextConfig: NextConfig = {
  // Le immagini CMS sono proxiate via /cms-media/* (vedi rewrites) — path locale, no remotePatterns necessari
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost', port: '3001' },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/cms-media/:path*',
        destination: `${CMS_URL}/api/media/file/:path*`,
      },
    ]
  },
  async redirects() {
    return LOCALES.map((locale) => ({
      source: `/${locale}/frank`,
      destination: `/${locale}/sebo`,
      permanent: true,
    }))
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
