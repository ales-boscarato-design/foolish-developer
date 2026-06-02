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

// Ricava l'hostname del CMS dall'env var per autorizzarlo come sorgente immagini
function cmsRemotePatterns(): { protocol: 'http' | 'https'; hostname: string; port?: string }[] {
  const patterns: { protocol: 'http' | 'https'; hostname: string; port?: string }[] = [
    { protocol: 'http', hostname: 'localhost', port: '3001' },
  ]
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL
  if (cmsUrl) {
    try {
      const { hostname, protocol, port } = new URL(cmsUrl)
      const entry: { protocol: 'http' | 'https'; hostname: string; port?: string } = {
        protocol: protocol.replace(':', '') as 'http' | 'https',
        hostname,
      }
      if (port) entry.port = port
      patterns.push(entry)
    } catch {
      // URL malformata — ignora
    }
  }
  return patterns
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: cmsRemotePatterns(),
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
