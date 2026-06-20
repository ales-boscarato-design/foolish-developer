import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['it', 'fr', 'en', 'es', 'de'] as const,
  defaultLocale: 'it',
  localePrefix: 'never',
  localeDetection: true,
})

export type Locale = (typeof routing.locales)[number]
