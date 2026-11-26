const PROMO_START = Date.parse('2026-11-27T00:00:00+01:00')
const PROMO_END = Date.parse('2026-12-01T00:00:00+01:00')

export function isPromoBarActive(now: Date): boolean {
  const time = now.getTime()
  return Number.isFinite(time) && time >= PROMO_START && time < PROMO_END
}
