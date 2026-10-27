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
      ({ data, originalDoc }) => {
        if (data.code && typeof data.code === 'string') {
          data.code = data.code.toUpperCase().trim()
        }
        const type = data.type ?? originalDoc?.type
        if (type === 'percent_tiered') {
          const min = data.minSubtotalCents ?? originalDoc?.minSubtotalCents
          const tier2 = data.tier2SubtotalCents ?? originalDoc?.tier2SubtotalCents
          const percent1 = data.discountPercent ?? originalDoc?.discountPercent
          const percent2 = data.tier2DiscountPercent ?? originalDoc?.tier2DiscountPercent
          if (
            !Number.isSafeInteger(min) || (min as number) <= 0
            || !Number.isSafeInteger(tier2) || (tier2 as number) <= (min as number)
            || typeof percent1 !== 'number' || !Number.isFinite(percent1) || percent1 <= 0 || percent1 > 100
            || typeof percent2 !== 'number' || !Number.isFinite(percent2) || percent2 <= 0 || percent2 > 100
            || percent1 === percent2
          ) throw new Error('Configurazione sconto progressivo non valida')
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      label: 'Codice',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
          return 'Il codice promo deve contenere solo lettere, numeri, _ o - (1–64 caratteri)'
        }
        return true
      },
    },
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
        { label: 'Sconto percentuale progressivo', value: 'percent_tiered' },
      ],
    },
    {
      name: 'discountPercent',
      type: 'number',
      label: 'Percentuale sconto (%)',
      admin: {
        condition: (data) => data.type === 'percent' || data.type === 'percent_tiered',
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
    {
      name: 'minSubtotalCents',
      type: 'number',
      label: 'Subtotale minimo (centesimi)',
      admin: { condition: (data) => data.type === 'percent_tiered' },
    },
    {
      name: 'tier2SubtotalCents',
      type: 'number',
      label: 'Soglia secondo livello (centesimi)',
      admin: { condition: (data) => data.type === 'percent_tiered' },
    },
    {
      name: 'tier2DiscountPercent',
      type: 'number',
      label: 'Percentuale secondo livello (%)',
      admin: { condition: (data) => data.type === 'percent_tiered' },
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
