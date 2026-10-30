import type { CollectionConfig, PayloadRequest } from 'payload'

type RelationValue = number | string | { id?: number | string } | null | undefined

function relationId(value: RelationValue): number | string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && value.id !== undefined && value.id !== null) return value.id
  return null
}

/**
 * Un file collegato a un cliente e' un documento privato: i suoi byte non devono essere
 * pubblici (Media.read consente l'accesso anonimo solo ai documenti `public`).
 *
 * In beforeChange `data` contiene solo il patch in ingresso, non il documento fuso: i
 * valori effettivi si leggono dal patch quando la chiave e' presente e da `originalDoc`
 * altrimenti.
 *
 * Nessun downgrade automatico: se il cliente viene rimosso il file resta `private`
 * (riportarlo pubblico e' una scelta esplicita in admin).
 */
async function ensurePrivateMediaFile({ data, originalDoc, req }: {
  data: Record<string, unknown>
  originalDoc?: Record<string, unknown> | null
  req: PayloadRequest
}): Promise<Record<string, unknown>> {
  const customer = 'customer' in data ? data.customer : originalDoc?.customer
  const file = 'file' in data ? data.file : originalDoc?.file

  const customerId = relationId(customer as RelationValue)
  const mediaId = relationId(file as RelationValue)
  if (!customerId || mediaId === null) return data

  const updated = await req.payload.update({
    collection: 'media',
    id: mediaId,
    data: { visibility: 'private' },
    depth: 0,
    overrideAccess: true,
    req,
  })

  if (!updated || (updated as { visibility?: string }).visibility !== 'private') {
    throw new Error('Impossibile marcare privato il file allegato al cliente: salvataggio rifiutato.')
  }

  return data
}

export const CustomerFiles: CollectionConfig = {
  slug: 'customer-files',
  admin: {
    useAsTitle: 'title',
    description: 'File e risorse per i clienti. Lascia "Cliente" vuoto per renderlo visibile a tutti.',
    defaultColumns: ['title', 'customer', 'fileType', 'active', 'createdAt'],
  },
  hooks: {
    beforeChange: [ensurePrivateMediaFile],
  },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
      return !!secret && secret === process.env.PAYLOAD_API_SECRET
    },
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Titolo',
    },
    {
      name: 'file',
      type: 'upload',
      relationTo: 'media',
      required: true,
      label: 'File',
    },
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      label: 'Cliente',
      admin: {
        description: 'Lascia vuoto per rendere il file visibile a tutti i clienti registrati.',
      },
    },
    {
      name: 'fileType',
      type: 'select',
      required: true,
      label: 'Tipo',
      options: [
        { label: 'Guida PDF', value: 'guide' },
        { label: 'Video', value: 'video' },
        { label: 'Risorsa', value: 'resource' },
      ],
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Attivo',
    },
  ],
}
