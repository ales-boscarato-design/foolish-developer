import type { CollectionConfig } from 'payload'

export const ProMembers: CollectionConfig = {
  slug: 'pro-members',
  admin: {
    useAsTitle: 'businessName',
    defaultColumns: ['businessName', 'vatNumber', 'status', 'discountCode', 'joinedAt'],
    group: 'Foolish Pro',
  },
  access: {
    create: ({ req }) => !!req.user,
    read: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    { name: 'vatNumber',     type: 'text',     required: true, unique: true, label: 'P.IVA / VAT Number' },
    { name: 'businessName',  type: 'text',     required: true,              label: 'Ragione sociale' },
    { name: 'contactName',   type: 'text',     required: true,              label: 'Nome contatto' },
    { name: 'email',         type: 'email',    required: true,              label: 'Email' },
    { name: 'phone',         type: 'text',                                  label: 'Telefono' },
    { name: 'telegramId',    type: 'text',                                  label: 'Telegram username' },
    { name: 'discountCode',  type: 'text',     required: true, unique: true, label: 'Codice sconto' },
    {
      name: 'status',
      type: 'select',
      defaultValue: 'active',
      required: true,
      label: 'Stato',
      options: [
        { label: 'Attivo',   value: 'active' },
        { label: 'Sospeso',  value: 'suspended' },
      ],
    },
    { name: 'channelInvited', type: 'checkbox', defaultValue: false, label: 'Invitato al canale Foolish Pro' },
    { name: 'totalSpent',    type: 'number',  defaultValue: 0, label: 'Totale speso (€)', admin: { readOnly: true } },
    { name: 'orderCount',    type: 'number',  defaultValue: 0, label: 'Numero ordini',    admin: { readOnly: true } },
    { name: 'notes',         type: 'textarea',                label: 'Note (Alessandro)' },
    { name: 'joinedAt',      type: 'date',    required: true, label: 'Data iscrizione' },
  ],
  timestamps: true,
}
