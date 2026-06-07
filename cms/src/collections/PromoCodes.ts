import type { CollectionConfig } from 'payload'

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'active', 'proMember', 'usageCount'],
    group: 'Foolish Pro',
  },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    { name: 'code',  type: 'text', required: true, unique: true, label: 'Codice' },
    {
      name: 'type',
      type: 'select',
      required: true,
      label: 'Tipo',
      options: [
        { label: 'Spedizione gratuita', value: 'free_shipping' },
        { label: 'Sconto % Pro',        value: 'percent_pro' },
      ],
    },
    { name: 'active', type: 'checkbox', defaultValue: true, label: 'Attivo' },
    {
      name: 'proMember',
      type: 'relationship',
      relationTo: 'pro-members' as 'users',
      required: false,
      label: 'Membro Pro',
    },
    { name: 'usageCount', type: 'number', defaultValue: 0, label: 'Utilizzi', admin: { readOnly: true } },
  ],
  timestamps: true,
}
