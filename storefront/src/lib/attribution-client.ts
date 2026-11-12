'use client'

import { normalizeAttribution, type AttributionSnapshot } from './attribution'

const STORAGE_KEY = 'foolish_attribution_v1'

export function captureAttribution(): void {
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) !== null) return
    const url = new URL(window.location.href)
    const referrerHost = document.referrer ? new URL(document.referrer).hostname : null
    const snapshot = normalizeAttribution({
      landingPath: url.pathname,
      referrerHost,
      utmSource: url.searchParams.get('utm_source'),
      utmMedium: url.searchParams.get('utm_medium'),
      utmCampaign: url.searchParams.get('utm_campaign'),
      utmTerm: url.searchParams.get('utm_term'),
      utmContent: url.searchParams.get('utm_content'),
      refSlug: url.searchParams.get('ref'),
    })
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch { /* Attribution is optional; storage/referrer failures must not affect the page. */ }
}

export function readAttribution(): AttributionSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return normalizeAttribution(JSON.parse(raw))
  } catch { return null }
}
