import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import sharp from 'sharp'
import path from 'path'
import { fileURLToPath } from 'url'

import { Products } from './collections/Products'
import { Orders } from './collections/Orders'
import { Customers } from './collections/Customers'
import { Media } from './collections/Media'
import { ProMembers } from './collections/ProMembers'
import { PromoCodes } from './collections/PromoCodes'
import { CustomerFiles } from './collections/CustomerFiles'
import { PushSequences } from './collections/PushSequences'
import { OfferConfig } from './collections/OfferConfig'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const mediaDir = process.env.MEDIA_UPLOAD_DIR ?? path.resolve(dirname, '../../public/media')
console.log('[CMS] MEDIA_UPLOAD_DIR:', process.env.MEDIA_UPLOAD_DIR ?? '(non impostato)')
console.log('[CMS] mediaDir risolto:', mediaDir)

export default buildConfig({
  localization: {
    locales: [
      { label: 'Italiano', code: 'it' },
      { label: 'English',  code: 'en' },
      { label: 'Deutsch',  code: 'de' },
      { label: 'Français', code: 'fr' },
      { label: 'Español',  code: 'es' },
    ],
    defaultLocale: 'it',
    fallback: true,
  },
  admin: {
    user: 'users',
    meta: {
      titleSuffix: '— Foolish Butcher',
      description: 'Pannello di controllo The Foolish Butcher',
    },
    theme: 'dark',
  },
  collections: [
    Products,
    Orders,
    Customers,
    Media,
    ProMembers,
    PromoCodes,
    CustomerFiles,
    PushSequences,
    OfferConfig,
    {
      slug: 'users',
      auth: {
        maxLoginAttempts: 5,
        lockTime: 30 * 60 * 1000, // 30 minuti
      },
      admin: {
        useAsTitle: 'email',
        group: 'Sistema',
      },
      fields: [],
    },
  ],
  editor: lexicalEditor({}),
  sharp,
  secret: process.env.PAYLOAD_SECRET!,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  serverURL: process.env.PAYLOAD_PUBLIC_URL || 'http://localhost:3001',
  cors: [
    process.env.STOREFRONT_URL || 'http://localhost:3000',
  ],
  csrf: [
    process.env.STOREFRONT_URL || 'http://localhost:3000',
  ],
})
