import type { CollectionConfig } from 'payload'

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'active', 'expiresAt', 'usageCount'],
    group: 'Foolish Pro',
  },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (data.code && typeof data.code === 'string') {
          data.code = data.code.toUpperCase().trim()
        }
        return data
      },
    ],
  },
  fields: [
    { name: 'code', type: 'text', required: true, unique: true, label: 'Codice' },
    {
      name: 'type',
      type: 'select',
      required: true,
      label: 'Tipo',
      options: [
        { label: 'Spedizione gratuita', value: 'free_shipping' },
        { label: 'Sconto % Pro',        value: 'percent_pro' },
        { label: 'Sconto %',            value: 'percent' },
        { label: 'Sconto importo fisso (€)', value: 'amount' },
      ],
    },
    {
      name: 'discountPercent',
      type: 'number',
      label: 'Percentuale sconto (%)',
      admin: {
        condition: (data) => data.type === 'percent',
        description: 'Es. 20 per il 20% di sconto',
      },
    },
    {
      name: 'discountAmount',
      type: 'number',
      label: 'Importo sconto (€)',
      admin: {
        condition: (data) => data.type === 'amount',
        description: 'Es. 15 per €15 di sconto',
      },
    },
    { name: 'active', type: 'checkbox', defaultValue: true, label: 'Attivo' },
    {
      name: 'expiresAt',
      type: 'date',
      label: 'Scadenza',
      admin: {
        description: 'Lascia vuoto per codice senza scadenza',
        date: { pickerAppearance: 'dayOnly', displayFormat: 'dd/MM/yyyy' },
      },
    },
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
