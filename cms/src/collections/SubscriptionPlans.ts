import type { CollectionConfig } from 'payload'
import { hasServiceAccess } from '../lib/serviceAccess'

export const SubscriptionPlans: CollectionConfig = {
  slug: 'subscription-plans',
  admin: {
    useAsTitle: 'key',
    description: 'Collega ogni piano di abbonamento (tattoo/pmu) al prodotto del catalogo che ne fornisce foto e descrizione.',
    defaultColumns: ['key', 'product', 'active', 'updatedAt'],
    group: 'Abbonamenti',
  },
  access: {
    read: ({ req }) => !!req.user || hasServiceAccess(req, 'subscription-plans', 'read'),
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
