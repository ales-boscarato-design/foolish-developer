/**
 * Segreto con cui lo storefront parla al CMS.
 *
 * `STOREFRONT_API_SECRET` e' il nome nuovo, con poteri limitati allo scope
 * storefront; `PAYLOAD_API_SECRET` resta come fallback durante la transizione
 * e va rimosso dopo la rotazione.
 */
export function cmsServiceSecret(): string {
  return process.env.STOREFRONT_API_SECRET || process.env.PAYLOAD_API_SECRET || ''
}

export function hasCmsServiceSecret(): boolean {
  return cmsServiceSecret().length > 0
}
