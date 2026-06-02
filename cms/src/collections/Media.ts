import type { CollectionConfig } from 'payload'

// In produzione Railway: monta un Volume su /data/media e imposta MEDIA_UPLOAD_DIR=/data/media
// In locale: i file vanno nella cartella public/media dello storefront
const staticDir = process.env.MEDIA_UPLOAD_DIR ?? '../public/media'

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
      if (doc?.sizes?.thumbnail?.url) return doc.sizes.thumbnail.url as string
      return typeof doc?.url === 'string' ? doc.url : ''
    },
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'Testo alternativo',
    },
  ],
}
