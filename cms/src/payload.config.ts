import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { nodemailerAdapter } from '@payloadcms/email-nodemailer'
import path from 'path'
import { fileURLToPath } from 'url'

import { Products } from './collections/Products'
import { Orders } from './collections/Orders'
import { Customers } from './collections/Customers'
import { Media } from './collections/Media'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

export default buildConfig({
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
    {
      slug: 'users',
      auth: {
        useAPIKey: true,
      },
      admin: {
        useAsTitle: 'email',
        group: 'Sistema',
      },
      fields: [],
    },
  ],
  editor: lexicalEditor({}),
  email: nodemailerAdapter({
    defaultFromAddress: process.env.EMAIL_FROM || 'noreply@thefoolishbutcher.com',
    defaultFromName: 'The Foolish Butcher',
    transportOptions: {
      host: process.env.SMTP_HOST || '',
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    },
  }),
  secret: process.env.PAYLOAD_SECRET || 'CHANGE_ME_IN_PRODUCTION',
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
