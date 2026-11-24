export type OrderAttribution = {
  landingPath: string | null
  referrerHost: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: null
  utmTerm: null
  utmContent: null
  refSlug: null
  sourceClass: 'direct' | 'organicSearch' | 'paidAds' | 'organicSocial' | 'referral' | 'llm' | 'unknown'
}

const sources = new Set([
  'google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave', 'qwant', 'yandex', 'baidu', 'startpage', 'seznam', 'naver',
  'google_ads', 'googleads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'tiktok_ads', 'linkedin_ads', 'microsoft_ads', 'bing_ads',
  'instagram', 'facebook', 'tiktok', 'linkedin', 'pinterest', 'youtube', 'x', 'twitter', 'chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot', 'anthropic', 'deepseek', 'mistral', 'affiliate',
])
const mediums = new Set(['referral', 'partner', 'cpc', 'ppc', 'paid', 'paid_social', 'paid-social', 'display', 'retargeting', 'cpm', 'social', 'social_media', 'organic_social', 'llm', 'ai'])
const hosts = new Set([
  'google.com', 'google.it', 'google.co.uk', 'google.de', 'google.fr', 'google.es', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'ecosia.org', 'search.brave.com', 'qwant.com', 'yandex.com', 'baidu.com', 'startpage.com', 'seznam.cz', 'naver.com',
  'instagram.com', 'facebook.com', 't.co', 'x.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'reddit.com', 'whatsapp.com', 'telegram.org', 'threads.net',
])
const locales = new Set(['it', 'en', 'de', 'fr', 'es'])
const snapshotFields = ['landingPath', 'referrerHost', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent', 'refSlug', 'sourceClass']
const sourceClasses = ['direct', 'organicSearch', 'paidAds', 'organicSocial', 'referral', 'llm', 'unknown']
const paidSources = new Set(['google_ads', 'googleads', 'meta_ads', 'facebook_ads', 'instagram_ads', 'tiktok_ads', 'linkedin_ads', 'microsoft_ads', 'bing_ads'])
const socialSources = new Set(['instagram', 'facebook', 'tiktok', 'linkedin', 'pinterest', 'youtube', 'x', 'twitter'])
const llmSources = new Set(['chatgpt', 'openai', 'perplexity', 'claude', 'gemini', 'copilot', 'anthropic', 'deepseek', 'mistral'])

function sourceClass(source: string | null, medium: string | null, host: string | null): OrderAttribution['sourceClass'] {
  if (medium === 'referral' || medium === 'partner' || source === 'affiliate') return 'referral'
  if (['cpc', 'ppc', 'paid', 'paid_social', 'paid-social', 'display', 'retargeting', 'cpm'].includes(medium ?? '') || paidSources.has(source ?? '')) return 'paidAds'
  if (['social', 'social_media', 'organic_social'].includes(medium ?? '') || socialSources.has(source ?? '')) return 'organicSocial'
  if (medium === 'llm' || medium === 'ai' || llmSources.has(source ?? '')) return 'llm'
  if (source && ['google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'brave', 'qwant', 'yandex', 'baidu', 'startpage', 'seznam', 'naver'].includes(source)) return 'organicSearch'
  if (source || medium) return 'referral'
  if (!host) return 'direct'
  if (['google.com', 'google.it', 'google.co.uk', 'google.de', 'google.fr', 'google.es', 'bing.com', 'duckduckgo.com', 'search.yahoo.com', 'ecosia.org', 'search.brave.com', 'qwant.com', 'yandex.com', 'baidu.com', 'startpage.com', 'seznam.cz', 'naver.com'].includes(host)) return 'organicSearch'
  if (['instagram.com', 'facebook.com', 't.co', 'x.com', 'linkedin.com', 'pinterest.com', 'tiktok.com', 'youtube.com', 'reddit.com', 'whatsapp.com', 'telegram.org', 'threads.net'].includes(host)) return 'organicSocial'
  return 'referral'
}

function supplied(value: unknown): boolean {
  return value !== null && value !== undefined && (typeof value !== 'string' || value.trim() !== '')
}

/** CMS-side second boundary: never trust storefront/webhook attribution input. */
export function sanitizeOrderAttribution(input: unknown): OrderAttribution {
  const value = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {}
  const pathMatch = typeof value.landingPath === 'string' ? /^\/(it|en|de|fr|es)\/?$/.exec(value.landingPath) : null
  const landingPath = pathMatch && locales.has(pathMatch[1]) ? `/${pathMatch[1]}/` : null
  let referrerHost: string | null = null
  if (typeof value.referrerHost === 'string') {
    try {
      const parsed = new URL(value.referrerHost.includes('://') ? value.referrerHost : `https://${value.referrerHost}`)
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
      if (!parsed.username && !parsed.password && hosts.has(host)) referrerHost = host
    } catch { /* Omit invalid/untrusted host. */ }
  }
  const sourceValue = typeof value.utmSource === 'string' ? value.utmSource.trim().toLowerCase() : ''
  const mediumValue = typeof value.utmMedium === 'string' ? value.utmMedium.trim().toLowerCase() : ''
  const utmSource = sources.has(sourceValue) ? sourceValue : null
  const utmMedium = mediums.has(mediumValue) ? mediumValue : null
  const discardedSourceInput =
    (supplied(value.referrerHost) && referrerHost === null)
    || (supplied(value.utmSource) && utmSource === null)
    || (supplied(value.utmMedium) && utmMedium === null)
    || supplied(value.utmCampaign) || supplied(value.utmTerm) || supplied(value.utmContent)
    || supplied(value.refSlug)
  const completeSnapshot = Object.keys(value).length === snapshotFields.length
    && snapshotFields.every((key) => Object.hasOwn(value, key))
    && snapshotFields.slice(0, -1).every((key) => value[key] === null || typeof value[key] === 'string')
    && sourceClasses.includes(value.sourceClass as string)
  const invalidSourceClass = supplied(value.sourceClass) && !sourceClasses.includes(value.sourceClass as string)
  const hasClassifiableSource = referrerHost !== null || utmSource !== null || utmMedium !== null
  const normalizedSourceClass = discardedSourceInput || invalidSourceClass || value.sourceClass === 'unknown'
    ? 'unknown'
    : hasClassifiableSource
    ? sourceClass(utmSource, utmMedium, referrerHost)
    : value.sourceClass === 'direct' && completeSnapshot ? 'direct' : 'unknown'
  return {
    landingPath, referrerHost, utmSource, utmMedium,
    utmCampaign: null, utmTerm: null, utmContent: null, refSlug: null,
    sourceClass: normalizedSourceClass,
  }
}
