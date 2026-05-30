import type { MetadataRoute } from 'next'

const BASE_URL = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/account/', '/checkout/', '/grazie/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  }
}
