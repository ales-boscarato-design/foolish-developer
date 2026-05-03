import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['it', 'en', 'fr', 'es', 'de'],
  defaultLocale: 'it',
  localePrefix: 'as-needed',
})
