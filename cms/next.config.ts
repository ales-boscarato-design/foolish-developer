import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  // Fix per monorepo: Turbopack rileva più package-lock.json (cms + storefront)
  // e sceglie il parent sbagliato come workspace root → chunk CSS/JS su path errato → 404
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@payload-config': path.resolve(__dirname, 'src/payload.config.ts'),
    }
    return config
  },
}

export default withPayload(nextConfig)
