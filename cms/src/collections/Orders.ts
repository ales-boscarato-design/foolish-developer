import type { CollectionConfig } from 'payload'

export const Orders: CollectionConfig = {
  slug: 'orders',
  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'customerEmail', 'pipelineState', 'total', 'createdAt'],
    group: 'Ordini',
  },
  access: {
    read: ({ req }) => !!req.user, // solo admin
    create: () => true,            // webhook può creare
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'orderNumber',
      type: 'text',
      required: true,
      unique: true,
      label: 'Numero ordine',
    },
    {
      name: 'source',
      type: 'select',
      defaultValue: 'storefront',
      label: 'Origine',
      options: [
        { label: 'Storefront', value: 'storefront' },
        { label: 'WooCommerce', value: 'woocommerce' },
        { label: 'Manuale', value: 'manual' },
      ],
    },
    {
      name: 'customerEmail',
      type: 'email',
      required: true,
      label: 'Email cliente',
    },
    {
      name: 'customerName',
      type: 'text',
      label: 'Nome cliente',
    },
    {
      name: 'customerTelegramId',
      type: 'text',
      label: 'Telegram ID cliente',
    },
    {
      name: 'lineItems',
      type: 'json',
      required: true,
      label: 'Prodotti ordinati',
    },
    {
      name: 'total',
      type: 'number',
      required: true,
      label: 'Totale (€)',
    },
    {
      name: 'shippingCost',
      type: 'number',
      label: 'Spedizione (€)',
    },
    {
      name: 'shippingAddress',
      type: 'group',
      label: 'Indirizzo spedizione',
      fields: [
        { name: 'name', type: 'text', label: 'Nome' },
        { name: 'address1', type: 'text', label: 'Indirizzo' },
        { name: 'address2', type: 'text', label: 'Interno/Piano' },
        { name: 'city', type: 'text', label: 'Città' },
        { name: 'postalCode', type: 'text', label: 'CAP' },
        { name: 'country', type: 'text', label: 'Paese (ISO 2)' },
      ],
    },
    {
      name: 'pipelineState',
      type: 'select',
      defaultValue: 'received',
      label: 'Stato pipeline',
      options: [
        { label: 'Ricevuto', value: 'received' },
        { label: 'In attesa ETA', value: 'eta_pending' },
        { label: 'ETA confermato', value: 'eta_confirmed' },
        { label: 'In produzione', value: 'in_production' },
        { label: 'Matching in attesa', value: 'matching_pending' },
        { label: 'Abbinato', value: 'matched' },
        { label: 'Preview inviata', value: 'preview_sent' },
        { label: 'Spedito', value: 'shipped' },
        { label: 'Consegnato', value: 'delivered' },
        { label: 'Follow-up fatto', value: 'followup_done' },
        { label: 'Chiuso', value: 'closed' },
      ],
    },
    {
      name: 'revolutOrderId',
      type: 'text',
      label: 'Revolut Order ID',
      admin: { readOnly: true },
    },
    {
      name: 'revolutStatus',
      type: 'text',
      label: 'Revolut Status',
      admin: { readOnly: true },
    },
    {
      name: 'trackingNumber',
      type: 'text',
      label: 'Tracking spedizione',
    },
    {
      name: 'trackingCarrier',
      type: 'text',
      label: 'Corriere',
    },
    {
      name: 'productionEtaDays',
      type: 'number',
      label: 'ETA produzione (giorni)',
    },
    {
      name: 'notes',
      type: 'textarea',
      label: 'Note interne',
    },
  ],
  timestamps: true,
}
