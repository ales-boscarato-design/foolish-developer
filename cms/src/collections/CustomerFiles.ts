import type { CollectionConfig } from 'payload'

export const CustomerFiles: CollectionConfig = {
  slug: 'customer-files',
  admin: {
    useAsTitle: 'title',
    description: 'File e risorse per i clienti. Lascia "Cliente" vuoto per renderlo visibile a tutti.',
    defaultColumns: ['title', 'customer', 'fileType', 'active', 'createdAt'],
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
