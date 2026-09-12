/**
 * Chooses the language the shop should show a visitor, among the locales it
 * actually publishes.
 *
 * The root of the storefront already localises a language-less URL from the
 * browser (`/` + a Spanish browser answers `307 /es`), so a link that pins a
 * visitor to one language fights the shop's own behaviour. This resolves the
 * same signal, from `Accept-Language`, for the referral link.
 *
 * Returns null when the header carries no usable preference, so callers fall
 * back to the locale they already have instead of inventing one.
 */
export function preferredLocale(
  header: string | null | undefined,
  locales: readonly string[],
): string | null {
  if (typeof header !== 'string' || header.trim() === '' || locales.length === 0) return null

  const ranked: Array<{ tag: string; quality: number }> = []
  for (const part of header.split(',')) {
    const [rawTag, ...parameters] = part.split(';')
    const tag = rawTag.trim().toLowerCase()
    if (tag === '') continue

    let quality = 1
    for (const parameter of parameters) {
      const match = /^\s*q\s*=\s*([0-9]*\.?[0-9]+)\s*$/i.exec(parameter)
      if (!match) continue
      const parsed = Number(match[1])
      if (Number.isFinite(parsed)) quality = parsed
    }
    // q=0 means "explicitly not acceptable", and a wildcard states no
    // preference: neither may choose a language for the visitor.
    if (quality <= 0 || tag === '*') continue

    ranked.push({ tag, quality })
  }

  // Highest quality first; Array.sort is stable, so the header order breaks ties.
  ranked.sort((a, b) => b.quality - a.quality)

  for (const entry of ranked) {
    const exact = locales.find((locale) => locale.toLowerCase() === entry.tag)
    if (exact) return exact
    const primary = entry.tag.split('-')[0]
    const byPrimary = locales.find((locale) => locale.toLowerCase() === primary)
    if (byPrimary) return byPrimary
  }

  return null
}
