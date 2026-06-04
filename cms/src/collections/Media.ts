import type { CollectionConfig } from 'payload'
import path from 'path'

// In produzione Railway: monta un Volume su /data/media e imposta MEDIA_UPLOAD_DIR=/data/media
// In locale: i file vanno nella cartella cms/public/media
const staticDir = process.env.MEDIA_UPLOAD_DIR
  ? path.resolve(process.env.MEDIA_UPLOAD_DIR)
  : path.resolve(process.cwd(), 'public/media')

console.log('[Media] staticDir:', staticDir)

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    group: 'Catalogo',
  },
  access: {
    read: () => true,
  },
  upload: {
    staticDir,
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 400, position: 'centre' },
      { name: 'card', width: 800, height: 800, position: 'centre' },
      { name: 'full', width: 1600, height: undefined },
    ],
    adminThumbnail: ({ doc }) => {
      const sizes = doc?.sizes as Record<string, { url?: string }> | undefined
      if (sizes?.thumbnail?.url) return sizes.thumbnail.url
      return typeof doc?.url === 'string' ? doc.url : ''
    },
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'Testo alternativo',
    },
  ],
}
