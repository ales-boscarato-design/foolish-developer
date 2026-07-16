import type { CollectionConfig, PayloadRequest } from 'payload'

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

export const Subscriptions: CollectionConfig = {
  slug: 'subscriptions',
  admin: {
    useAsTitle: 'stripeSubscriptionId',
    defaultColumns: ['customerEmail', 'plan', 'zone', 'status', 'cyclesCompleted', 'startedAt'],
    group: 'Abbonamenti',
  },
  access: {
    read: ({ req }) => !!req.user || hasStorefrontSecret(req),
    create: ({ req }) => !!req.user || hasStorefrontSecret(req),
    update: ({ req }) => !!req.user || hasStorefrontSecret(req),
    delete: ({ req }) => !!req.user,
  },
  fields: [
    { name: 'customerEmail', type: 'email', required: true, label: 'Email cliente' },
    {
      name: 'plan',
      type: 'select',
      required: true,
      label: 'Piano',
      options: [
        { label: 'Tattoo XXL', value: 'tattoo' },
        { label: 'PMU 3 Visi', value: 'pmu' },
      ],
    },
    {
      name: 'zone',
      type: 'select',
      required: true,
      label: 'Zona',
      options: [
        { label: 'Italia', value: 'IT' },
        { label: 'Europa', value: 'EU' },
      ],
    },
    { name: 'stripeSubscriptionId', type: 'text', required: true, unique: true, label: 'Stripe Subscription ID' },
    { name: 'stripeScheduleId', type: 'text', label: 'Stripe Schedule ID' },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      label: 'Stato',
      options: [
        { label: 'Attivo', value: 'active' },
        { label: 'In cancellazione (fine periodo)', value: 'canceling' },
        { label: 'Cancellato', value: 'canceled' },
      ],
    },
    { name: 'cyclesCompleted', type: 'number', defaultValue: 0, label: 'Cicli completati', admin: { readOnly: true } },
    { name: 'startedAt', type: 'date', label: 'Iniziato il' },
    { name: 'canceledAt', type: 'date', label: 'Cancellato il' },
  ],
  timestamps: true,
}
