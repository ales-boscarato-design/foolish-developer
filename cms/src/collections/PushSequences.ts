import type { CollectionConfig } from 'payload'

export const PushSequences: CollectionConfig = {
  slug: 'push-sequences',
  admin: {
    useAsTitle: 'name',
    description: 'Sequenze di notifiche push automatiche per i clienti. Ogni sequenza ha un trigger e una lista di step con ritardo e testo.',
    defaultColumns: ['name', 'trigger', 'active', 'updatedAt'],
    group: 'Marketing',
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
      name: 'name',
      type: 'text',
      required: true,
      label: 'Nome sequenza',
      admin: {
        description: 'Es. "Benvenuto all\'attivazione", "Follow-up post-consegna"',
      },
    },
    {
      name: 'trigger',
      type: 'select',
      required: true,
      label: 'Trigger',
      options: [
        { label: 'Attivazione notifiche (primo subscribe)', value: 'on_subscribe' },
        { label: 'Ordine spedito', value: 'on_order_shipped' },
        { label: 'Ordine consegnato', value: 'on_order_delivered' },
        { label: 'Manuale (Frank)', value: 'manual' },
      ],
      admin: {
        description: 'Quando parte questa sequenza.',
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Attiva',
      admin: {
        description: 'Disattiva per mettere in pausa tutta la sequenza.',
      },
    },
    {
      name: 'steps',
      type: 'array',
      label: 'Step',
      minRows: 1,
      admin: {
        description: 'Ogni step viene inviato dopo il ritardo specificato dal trigger.',
      },
      fields: [
        {
          name: 'step_key',
          type: 'text',
          required: true,
          label: 'Chiave univoca',
          admin: {
            description: 'Es. "welcome", "discount_48h", "review_7d". Non cambiare dopo il lancio.',
          },
        },
        {
          name: 'delay_hours',
          type: 'number',
          required: true,
          defaultValue: 0,
          label: 'Ritardo (ore)',
          admin: {
            description: '0 = immediato. 48 = dopo 2 giorni. 168 = dopo 1 settimana.',
          },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          label: 'Titolo notifica',
        },
        {
          name: 'body',
          type: 'text',
          required: true,
          label: 'Testo notifica',
        },
        {
          name: 'url',
          type: 'text',
          label: 'URL destinazione',
          defaultValue: '/account',
          admin: {
            description: 'Path relativo. Es. "/account/ordini", "/it", "/account".',
          },
        },
        {
          name: 'active',
          type: 'checkbox',
          defaultValue: true,
          label: 'Step attivo',
        },
      ],
    },
  ],
}
