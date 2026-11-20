/**
 * Segreto con cui il portale B2B parla al CMS.
 *
 * `B2B_API_SECRET` e' il nome nuovo, limitato allo scope b2b; il valore legacy
 * resta come fallback durante la transizione e va rimosso dopo la rotazione.
 */
export function cmsServiceSecret(): string {
  return process.env.B2B_API_SECRET || process.env.PAYLOAD_API_SECRET || ''
}
