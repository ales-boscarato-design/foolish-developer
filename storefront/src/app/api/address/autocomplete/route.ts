import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

interface NominatimResult {
  display_name: string
  address?: {
    road?: string
    pedestrian?: string
    footway?: string
    house_number?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    postcode?: string
    country_code?: string
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const countrycode = req.nextUrl.searchParams.get('countrycode') ?? ''

  if (q.length < 3) return NextResponse.json([])

  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '1',
    limit: '5',
  })
  if (countrycode) params.set('countrycodes', countrycode.toLowerCase())

  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: {
        'User-Agent': 'FoolishStorefront/1.0 (thefoolishbutcher.com)',
        'Accept-Language': 'it,en',
      },
      next: { revalidate: 60 },
    })
    if (!res.ok) return NextResponse.json([])

    const data: NominatimResult[] = await res.json()

    return NextResponse.json(
      data.map((item) => ({
        label: item.display_name,
        road: item.address?.road ?? item.address?.pedestrian ?? item.address?.footway ?? '',
        houseNumber: item.address?.house_number ?? '',
        city:
          item.address?.city ??
          item.address?.town ??
          item.address?.village ??
          item.address?.municipality ??
          '',
        postcode: item.address?.postcode ?? '',
        countryCode: item.address?.country_code?.toUpperCase() ?? '',
      }))
    )
  } catch {
    return NextResponse.json([])
  }
}
