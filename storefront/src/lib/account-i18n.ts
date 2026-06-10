// Server-only: uses next/headers cookies()
import { cookies } from 'next/headers'
export { getT, SUPPORTED_LOCALES } from './account-translations'
export type { AccountLocale, AccountTKey } from './account-translations'

export async function getAccountLocale(): Promise<import('./account-translations').AccountLocale> {
  const { SUPPORTED_LOCALES } = await import('./account-translations')
  const jar = await cookies()
  const val = jar.get('foolish_locale')?.value
  if (val && SUPPORTED_LOCALES.includes(val as import('./account-translations').AccountLocale))
    return val as import('./account-translations').AccountLocale
  return 'it'
}
