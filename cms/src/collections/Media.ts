import type { CollectionConfig } from 'payload'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: {
    group: 'Catalogo',
  },
  access: {
    read: () => true,
  },
  upload: {
    staticDir: '../public/media',
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
