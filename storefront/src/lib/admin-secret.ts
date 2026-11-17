/**
 * Segreto degli endpoint interni dello storefront
 * (POST /api/admin/create-offer e GET /api/marketing/stats).
 *
 * Ha un valore dedicato per non riusare il segreto di servizio: se il valore
 * condiviso con il CMS trapela, non apre anche questi endpoint. I fallback
 * coprono la transizione.
 */
export function adminSecret(): string {
  return (
    process.env.FOOLISH_ADMIN_SECRET ||
    process.env.STOREFRONT_API_SECRET ||
    process.env.PAYLOAD_API_SECRET ||
    ''
  )
}
