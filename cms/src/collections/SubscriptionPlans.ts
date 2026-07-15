import type { CollectionConfig, PayloadRequest } from 'payload'

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

export const SubscriptionPlans: CollectionConfig = {
  slug: 'subscription-plans',
  admin: {
    useAsTitle: 'key',
    description: 'Collega ogni piano di abbonamento (tattoo/pmu) al prodotto del catalogo che ne fornisce foto e descrizione.',
    defaultColumns: ['key', 'product', 'active', 'updatedAt'],
    group: 'Abbonamenti',
  },
  access: {
    read: ({ req }) => !!req.user || hasStorefrontSecret(req),
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'key',
      type: 'select',
      required: true,
      unique: true,
      label: 'Piano',
      options: [
        { label: 'Tattoo XXL', value: 'tattoo' },
        { label: 'PMU 3 Visi', value: 'pmu' },
      ],
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      label: 'Prodotto (foto/descrizione)',
      admin: { description: 'Il prodotto del catalogo mostrato nella pagina di abbonamento.' },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Attivo',
    },
  ],
  timestamps: true,
}
