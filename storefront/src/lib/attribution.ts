export type AttributionSourceClass = 'direct' | 'organicSearch' | 'paidAds' | 'organicSocial' | 'referral' | 'llm' | 'unknown'

export interface AttributionSnapshot {
  landingPath: string | null
  referrerHost: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  refSlug: string | null
  sourceClass: AttributionSourceClass
}

export const MAX_ATTRIBUTION_METADATA_LENGTH = 480
const SOURCE_CLASSES: readonly AttributionSourceClass[] = ['direct', 'organicSearch', 'paidAds', 'organicSocial', 'referral', 'llm', 'unknown']
const SNAPSHOT_FIELDS = ['landingPath', 'referrerHost', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'refSlug', 'sourceClass'] as const
// Analytics values are untrusted, including values re-read from browser storage,
// checkout payloads and historical Stripe metadata. Retain only fixed vocabularies.
const SAFE_UTM_SOURCES = new Set([
  'google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave', 'qwant', 'yandex', 'baidu', 'startpage', 'seznam', 'naver',
  'google_ads', 'googleads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'tiktok_ads', 'linkedin_ads', 'microsoft_ads', 'bing_ads',
  'instagram', 'facebook', 'tiktok', 'linkedin', 'pinterest', 'youtube', 'x', 'twitter', 'chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot', 'anthropic', 'deepseek', 'mistral', 'affiliate',
])
const SAFE_UTM_MEDIUMS = new Set([
  'referral', 'partner', 'cpc', 'ppc', 'paid', 'paid_social', 'paid-social', 'display', 'retargeting', 'cpm',
  'social', 'social_media', 'organic_social', 'llm', 'ai',
])
const SAFE_REFERRER_HOSTS = new Set([
  'google.com', 'google.it', 'google.co.uk', 'google.de', 'google.fr', 'google.es',
  'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'ecosia.org', 'search.brave.com', 'qwant.com', 'yandex.com', 'baidu.com', 'startpage.com', 'seznam.cz', 'naver.com',
  'instagram.com', 'facebook.com', 't.co', 'x.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'reddit.com', 'whatsapp.com', 'telegram.org', 'threads.net',
])
const LOCALES = new Set(['it', 'en', 'de', 'fr', 'es'])

export const UNKNOWN_ATTRIBUTION: AttributionSnapshot = {
  landingPath: null, referrerHost: null, utmSource: null, utmMedium: null,
  utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null, sourceClass: 'unknown',
}
export const EMPTY_ATTRIBUTION: AttributionSnapshot = { ...UNKNOWN_ATTRIBUTION }

// Classificazione deterministica: prima vince lo slug, poi referral, paid, social, LLM, altri UTM, quindi referrer.
export const ATTRIBUTION_SOURCE_MAP = {
  referralMediums: ['referral', 'affiliate', 'partner'],
  affiliateSources: ['affiliate'],
  paidMediums: ['cpc', 'ppc', 'paid', 'paid_social', 'paid-social', 'display', 'retargeting', 'cpm'],
  paidSources: ['google_ads', 'googleads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'tiktok_ads', 'linkedin_ads', 'microsoft_ads', 'bing_ads'],
  socialMediums: ['social', 'social_media', 'organic_social'],
  socialSources: ['instagram', 'facebook', 'tiktok', 'linkedin', 'pinterest', 'youtube', 'x', 'twitter'],
  llmMediums: ['llm', 'ai'],
  llmSources: ['chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot', 'anthropic', 'deepseek', 'mistral'],
  searchHosts: ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave', 'qwant', 'yandex', 'baidu', 'startpage', 'seznam', 'naver'],
  socialHosts: ['instagram', 'facebook', 't.co', 'x.com', 'linkedin', 'pinterest', 'tiktok', 'youtube', 'reddit', 'whatsapp', 'telegram', 'threads'],
} as const

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function isCompleteSnapshot(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === SNAPSHOT_FIELDS.length && SNAPSHOT_FIELDS.every((key) => Object.hasOwn(value, key))
}

export function isAttributionSnapshot(input: unknown): input is AttributionSnapshot {
  const value = record(input)
  return Boolean(value && isCompleteSnapshot(value)
    && SOURCE_CLASSES.includes(value.sourceClass as AttributionSourceClass)
    && SNAPSHOT_FIELDS.slice(0, -1).every((key) => value[key] === null || typeof value[key] === 'string'))
}

function validPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Only locale home pages are retained. All other paths can contain a Pro
  // code, customer/product slug, or future identifier-bearing route segment.
  const match = /^\/(it|en|de|fr|es)\/?$/.exec(value)
  return match && LOCALES.has(match[1]) ? `/${match[1]}/` : null
}

function validHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.username || url.password) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return SAFE_REFERRER_HOSTS.has(host) ? host : null
  } catch { return null }
}

function supplied(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')
}

function hostMatchesBrand(host: string, brand: string): boolean {
  return host === brand || host.startsWith(`${brand}.`) || host.includes(`.${brand}.`) || host.endsWith(`.${brand}`)
}

function deriveSourceClass(fields: Omit<AttributionSnapshot, 'sourceClass'>): AttributionSourceClass {
  if (fields.refSlug) return 'referral'
  const source = fields.utmSource
  const medium = fields.utmMedium
  const map = ATTRIBUTION_SOURCE_MAP
  if (map.referralMediums.includes(medium as never) || map.affiliateSources.includes(source as never)) return 'referral'
  if (map.paidMediums.includes(medium as never) || map.paidSources.includes(source as never)) return 'paidAds'
  if (map.socialMediums.includes(medium as never) || map.socialSources.includes(source as never)) return 'organicSocial'
  if (map.llmMediums.includes(medium as never) || map.llmSources.includes(source as never)) return 'llm'
  if (source && map.searchHosts.includes(source as never)) return 'organicSearch'
  if (source || medium || fields.utmCampaign || fields.utmTerm || fields.utmContent) return 'referral'
  if (!fields.referrerHost) return 'direct'
  const referrerHost = fields.referrerHost
  if (map.searchHosts.some((brand) => hostMatchesBrand(referrerHost, brand))) return 'organicSearch'
  if (map.socialHosts.some((brand) => hostMatchesBrand(referrerHost, brand))) return 'organicSocial'
  return 'referral'
}

function normalizeAttributionWithCaptureEvidence(input: unknown, capturedDirect = false): AttributionSnapshot {
  const value = record(input)
  if (!value) return { ...UNKNOWN_ATTRIBUTION }
  const landingPath = validPath(value.landingPath)
  const referrerHost = validHost(value.referrerHost)
  const sourceValueSupplied = supplied(value.utmSource)
  const mediumValueSupplied = supplied(value.utmMedium)
  const utmSourceValue = typeof value.utmSource === 'string' ? value.utmSource.trim().toLowerCase() : ''
  const utmMediumValue = typeof value.utmMedium === 'string' ? value.utmMedium.trim().toLowerCase() : ''
  const utmSource = SAFE_UTM_SOURCES.has(utmSourceValue) ? utmSourceValue : null
  const utmMedium = SAFE_UTM_MEDIUMS.has(utmMediumValue) ? utmMediumValue : null
  // Campaign, term and content are arbitrary advertiser-controlled strings.
  // No public, non-identifying vocabulary is established for them.
  const utmCampaign = null
  const utmTerm = null
  const utmContent = null
  // The repository does not establish that referral slugs are public and
  // non-customer-identifying. Functional affiliate handling remains separate.
  const refSlug = null
  const fields = { landingPath, referrerHost, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, refSlug }
  const discardedSourceInput =
    (supplied(value.referrerHost) && referrerHost === null)
    || (sourceValueSupplied && utmSource === null)
    || (mediumValueSupplied && utmMedium === null)
    || supplied(value.utmCampaign) || supplied(value.utmTerm) || supplied(value.utmContent)
    || supplied(value.refSlug)
  const invalidSourceClass = supplied(value.sourceClass) && !SOURCE_CLASSES.includes(value.sourceClass as AttributionSourceClass)
  const hasClassifiableSource = referrerHost !== null || utmSource !== null || utmMedium !== null
  const explicitDirectSnapshot = value.sourceClass === 'direct' && isAttributionSnapshot(value)
  const sourceClass = discardedSourceInput || invalidSourceClass || value.sourceClass === 'unknown'
    ? 'unknown'
    : hasClassifiableSource
      ? deriveSourceClass(fields)
      : capturedDirect || explicitDirectSnapshot ? 'direct' : 'unknown'
  return { ...fields, sourceClass }
}

export function normalizeAttribution(input: unknown): AttributionSnapshot {
  return normalizeAttributionWithCaptureEvidence(input)
}

/** Only the browser capture path may assert direct from a freshly observed absence of source signals. */
export function normalizeCapturedAttribution(input: unknown): AttributionSnapshot {
  return normalizeAttributionWithCaptureEvidence(input, true)
}

export function buildAttributionMetadata(input: unknown): string | null {
  const snapshot = normalizeAttribution(input)
  if (snapshot.sourceClass === 'unknown' && Object.entries(snapshot).every(([key, value]) => key === 'sourceClass' || value === null)) return null
  const result: Record<string, string | null> = { ...snapshot }
  const dropOrder = ['landingPath', 'utmContent', 'utmTerm', 'utmCampaign', 'referrerHost', 'utmMedium', 'utmSource']
  let serialized = JSON.stringify(result)
  for (const field of dropOrder) {
    if (serialized.length <= MAX_ATTRIBUTION_METADATA_LENGTH) break
    result[field] = null
    serialized = JSON.stringify(result)
  }
  return serialized.length <= MAX_ATTRIBUTION_METADATA_LENGTH ? serialized : null
}

export function parseAttributionMetadata(raw: unknown): AttributionSnapshot {
  if (typeof raw !== 'string' || raw.length > MAX_ATTRIBUTION_METADATA_LENGTH) return { ...UNKNOWN_ATTRIBUTION }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return { ...UNKNOWN_ATTRIBUTION } }
  const value = record(parsed)
  if (!value) return { ...UNKNOWN_ATTRIBUTION }
  const keys = ['landingPath', 'referrerHost', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'refSlug', 'sourceClass']
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) return { ...UNKNOWN_ATTRIBUTION }
  if (value.sourceClass !== 'unknown' && !SOURCE_CLASSES.includes(value.sourceClass as AttributionSourceClass)) return { ...UNKNOWN_ATTRIBUTION }
  for (const key of keys.slice(0, -1)) if (value[key] !== null && typeof value[key] !== 'string') return { ...UNKNOWN_ATTRIBUTION }
  const normalized = normalizeAttribution(value)
  if (keys.slice(0, -1).some((key) => value[key] !== null && normalized[key as keyof AttributionSnapshot] === null)) return { ...UNKNOWN_ATTRIBUTION }
  if (normalized.sourceClass !== value.sourceClass) return { ...UNKNOWN_ATTRIBUTION }
  return normalized
}
