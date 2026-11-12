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
const UTM_LIMIT = 100
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const SOURCE_CLASSES: readonly AttributionSourceClass[] = ['direct', 'organicSearch', 'paidAds', 'organicSocial', 'referral', 'llm', 'unknown']

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

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().toLowerCase()
  if (!cleaned || cleaned.length > max || /javascript:|data:|\{\{|[<>]/i.test(cleaned)) return null
  return cleaned
}

function validPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.split('#', 1)[0] ?? ''
  if (path.length > 200 || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[?#]/.test(path)) return null
  return path
}

function validHost(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    if (url.username || url.password) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    return host.length <= 100 && /^[a-z0-9.-]+$/.test(host) ? host : null
  } catch { return null }
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
  if (source || medium || fields.utmCampaign || fields.utmTerm || fields.utmContent) return 'referral'
  if (!fields.referrerHost) return 'direct'
  const referrerHost = fields.referrerHost
  if (map.searchHosts.some((brand) => hostMatchesBrand(referrerHost, brand))) return 'organicSearch'
  if (map.socialHosts.some((brand) => hostMatchesBrand(referrerHost, brand))) return 'organicSocial'
  return 'referral'
}

export function normalizeAttribution(input: unknown): AttributionSnapshot {
  const value = record(input)
  if (!value) return { ...UNKNOWN_ATTRIBUTION }
  const landingPath = validPath(value.landingPath)
  const referrerHost = validHost(value.referrerHost)
  const utmSource = cleanString(value.utmSource, UTM_LIMIT)
  const utmMedium = cleanString(value.utmMedium, UTM_LIMIT)
  const utmCampaign = cleanString(value.utmCampaign, UTM_LIMIT)
  const utmTerm = cleanString(value.utmTerm, UTM_LIMIT)
  const utmContent = cleanString(value.utmContent, UTM_LIMIT)
  const rawSlug = value.refSlug
  const refSlug = typeof rawSlug === 'string' && rawSlug.length <= 63 && SLUG_RE.test(rawSlug) ? rawSlug : null
  const fields = { landingPath, referrerHost, utmSource, utmMedium, utmCampaign, utmTerm, utmContent, refSlug }
  return { ...fields, sourceClass: deriveSourceClass(fields) }
}

export function buildAttributionMetadata(input: unknown): string | null {
  const snapshot = normalizeAttribution(input)
  if (Object.entries(snapshot).every(([key, value]) => key === 'sourceClass' || value === null)) return null
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
