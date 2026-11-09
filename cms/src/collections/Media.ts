import type { CollectionConfig, PayloadRequest } from 'payload'
import path from 'path'

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

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
    // Un file marcato `private` e' un documento di un singolo cliente: i suoi byte non
    // devono essere pubblici. Payload applica questo access anche all'endpoint
    // /api/media/file/:filename (uploads/checkFileAccess.js): se la funzione ritorna un
    // where constraint il documento viene cercato con quel vincolo e la risposta e' 403
    // quando non combacia. Ritornare `true` invece NON aggiunge alcun vincolo e serve i byte.
    // Catalogo e immagini pubbliche restano leggibili da chiunque (visibility = 'public').
    read: ({ req }) => {
      if (req.user) return true
      if (hasStorefrontSecret(req)) return true
      return { visibility: { not_equals: 'private' } }
    },
    create: ({ req }) => {
      if (req.user) return true
      return hasStorefrontSecret(req)
    },
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
    mimeTypes: [
      'image/png', 'image/jpeg', 'image/webp',
      'video/mp4', 'video/webm',
      'application/pdf',
      'application/zip', 'application/x-zip-compressed',
      'application/octet-stream',
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      label: 'Testo alternativo',
    },
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'public',
      index: true,
      label: 'Visibilita',
      options: [
        { label: 'Pubblico (catalogo, sito)', value: 'public' },
        { label: 'Privato (documento di un cliente)', value: 'private' },
      ],
      admin: {
        description:
          'Privato = i byte sono scaricabili solo dal cliente proprietario attraverso lo storefront. ' +
          'Un file collegato a un record "File cliente" con Cliente valorizzato viene marcato privato automaticamente.',
      },
    },
  ],
}
