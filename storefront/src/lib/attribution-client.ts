'use client'

import { normalizeAttribution, normalizeCapturedAttribution, UNKNOWN_ATTRIBUTION, isAttributionSnapshot, type AttributionSnapshot } from './attribution'

const STORAGE_KEY = 'foolish_attribution_v1'

export function captureAttribution(): void {
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) !== null) return
    const url = new URL(window.location.href)
    const referrerHost = document.referrer ? new URL(document.referrer).hostname : null
    const snapshot = normalizeCapturedAttribution({
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
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY)
  } catch { return null }
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { ...UNKNOWN_ATTRIBUTION } }
  if (!isAttributionSnapshot(parsed)) return { ...UNKNOWN_ATTRIBUTION }
  return normalizeAttribution(parsed)
}
