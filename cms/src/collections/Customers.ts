import type { CollectionConfig } from 'payload'

export const Customers: CollectionConfig = {
  slug: 'customers',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'totalOrders', 'country', 'tags', 'updatedAt'],
    listSearchableFields: ['email', 'name'],
    group: 'Clienti',
  },
  access: {
    read: ({ req }) => !!req.user,
    create: () => true,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'email',
      type: 'email',
      required: true,
      unique: true,
      label: 'Email',
    },
    {
      name: 'name',
      type: 'text',
      label: 'Nome',
    },
    {
      name: 'telegramId',
      type: 'text',
      label: 'Telegram ID',
    },
    {
      name: 'telegramUsername',
      type: 'text',
      label: 'Telegram username',
    },
    {
      name: 'preferredChannel',
      type: 'select',
      defaultValue: 'email',
      label: 'Canale preferito',
      options: [
        { label: 'Telegram', value: 'telegram' },
        { label: 'Email', value: 'email' },
      ],
    },
    {
      name: 'country',
      type: 'text',
      label: 'Paese (ISO 2)',
      admin: { description: 'Es. IT, DE, FR' },
    },
    {
      name: 'totalOrders',
      type: 'number',
      defaultValue: 0,
      label: 'Totale ordini',
      admin: { readOnly: true },
    },
    {
      name: 'notes',
      type: 'textarea',
      label: 'Note (Alessandro)',
      admin: { description: 'Visibili solo ad Alessandro. Modificabili anche via Telegram.' },
    },
    {
      name: 'tags',
      type: 'select',
      hasMany: true,
      label: 'Tag',
      options: [
        { label: 'Tatuatore', value: 'tatuatore' },
        { label: 'PMU', value: 'pmu' },
        { label: 'Studente', value: 'studente' },
        { label: 'Professionista', value: 'professionista' },
        { label: 'VIP', value: 'vip' },
      ],
    },
  ],
  timestamps: true,
}
