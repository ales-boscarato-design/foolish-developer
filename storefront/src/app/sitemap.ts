import type { MetadataRoute } from 'next'
import { getProducts } from '@/lib/cms'

const BASE_URL = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'
const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const

const STATIC_ROUTES = [
  '',
  '/tattoo',
  '/pmu',
  '/limited',
  '/contatti',
  '/privacy',
  '/termini',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = []

  // Static pages — one entry per locale
  for (const route of STATIC_ROUTES) {
    for (const locale of LOCALES) {
      entries.push({
        url: `${BASE_URL}/${locale}${route}`,
        changeFrequency: route === '' ? 'daily' : 'weekly',
        priority: route === '' ? 1.0 : 0.7,
      })
    }
  }

  // Product pages — one entry per product per locale
  try {
    const products = await getProducts()
    for (const product of products) {
      for (const locale of LOCALES) {
        entries.push({
          url: `${BASE_URL}/${locale}/prodotto/${product.slug}`,
          changeFrequency: 'weekly',
          priority: 0.9,
        })
      }
    }
  } catch {
    // CMS unavailable — sitemap generata senza prodotti, non bloccare
  }

  return entries
}
