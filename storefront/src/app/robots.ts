import type { MetadataRoute } from 'next'

const BASE_URL = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/account/',
          '/checkout/',
          '/grazie/',
          // Legacy Shopify paths
          '/cdn/',
          '/collections/',
          '/products/',
          '/blogs/',
          '/pages/',
          // Legacy WordPress paths
          '/wp-login.php',
          '/wp-admin/',
          '/xmlrpc.php',
          // Legacy product lines removed
          '/duoskin',
          '/woodskin',
          '/en/duoskin',
          '/it/duoskin',
          '/en/woodskin',
          '/it/woodskin',
          // Misc paths crawlers probe
          '/meta.json',
          '/.git/',
          '/.env',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
