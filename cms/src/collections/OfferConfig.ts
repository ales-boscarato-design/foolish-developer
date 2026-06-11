import type { CollectionConfig } from 'payload'

export const OfferConfig: CollectionConfig = {
  slug: 'offer-config',
  admin: {
    useAsTitle: 'title',
    description: 'Configurazione offerta post-ordine. Crea un solo documento attivo.',
    defaultColumns: ['title', 'active', 'discountBelow', 'discountAbove', 'updatedAt'],
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
      name: 'title',
      type: 'text',
      required: true,
      defaultValue: 'Offerta post-ordine',
      label: 'Nome configurazione',
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Attiva',
      admin: { description: 'Disattiva per non generare offerte sui nuovi ordini.' },
    },
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      label: 'Prodotto da offrire',
      admin: { description: 'Il prodotto mostrato nella sezione Collezione dopo un ordine.' },
    },
    {
      name: 'threshold',
      type: 'number',
      required: true,
      defaultValue: 50,
      label: 'Soglia (€)',
      admin: { description: 'Ordini sotto questa cifra ricevono lo sconto minore, sopra quello maggiore.' },
    },
    {
      name: 'discountBelow',
      type: 'number',
      required: true,
      defaultValue: 10,
      label: 'Sconto sotto soglia (%)',
    },
    {
      name: 'discountAbove',
      type: 'number',
      required: true,
      defaultValue: 15,
      label: 'Sconto sopra soglia (%)',
    },
    {
      name: 'validityHours',
      type: 'number',
      required: true,
      defaultValue: 24,
      label: 'Validità offerta (ore)',
    },
  ],
}
