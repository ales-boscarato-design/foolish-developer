import { Nav } from '@/components/Nav'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const CMS_TOKEN = process.env.PAYLOAD_API_TOKEN || ''

async function hasLimitedProducts(): Promise<boolean> {
  if (!CMS_TOKEN) return false
  try {
    const res = await fetch(
      `${CMS_URL}/api/products?where[limitedStock][equals]=true&limit=1`,
      {
        headers: { Authorization: `Bearer ${CMS_TOKEN}` },
        next: { revalidate: 60 },
      },
    )
    if (!res.ok) return false
    const data = await res.json()
    return (data.totalDocs ?? 0) > 0
  } catch {
    return false
  }
}

export async function NavWrapper() {
  const showLimited = await hasLimitedProducts()
  return <Nav hasLimitedProducts={showLimited} />
}
