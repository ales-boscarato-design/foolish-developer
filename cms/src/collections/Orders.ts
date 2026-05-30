import type { CollectionConfig, CollectionAfterChangeHook } from 'payload'

const sendOrderConfirmation: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create') return
  if (!doc.customerEmail) return

  const items: Array<{ name: string; variantLabel: string; quantity: number; unitPrice: number }> =
    Array.isArray(doc.lineItems) ? doc.lineItems : []

  const itemsHtml = items
    .map(
      (i) =>
        `<tr>
          <td style="padding:4px 8px">${i.name} — ${i.variantLabel}</td>
          <td style="padding:4px 8px;text-align:center">${i.quantity}</td>
          <td style="padding:4px 8px;text-align:right">${(i.unitPrice * i.quantity).toFixed(2)}€</td>
        </tr>`,
    )
    .join('')

  const shippingLine =
    doc.shippingCost > 0
      ? `<tr><td style="padding:4px 8px">Spedizione</td><td></td><td style="padding:4px 8px;text-align:right">${Number(doc.shippingCost).toFixed(2)}€</td></tr>`
      : `<tr><td style="padding:4px 8px" colspan="3" style="color:#4caf50">Spedizione gratuita</td></tr>`

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">Ordine ricevuto.</h2>
  <p style="color:#555;margin-top:0">Riferimento: <strong>${doc.orderNumber}</strong></p>

  <p>Ciao ${doc.customerName ?? ''},<br>
  Ho ricevuto il tuo ordine. Lo produco personalmente — ti scrivo appena è pronto con le foto di quello che ti mando.</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead>
      <tr style="border-bottom:1px solid #eee">
        <th style="text-align:left;padding:4px 8px">Prodotto</th>
        <th style="padding:4px 8px">Qtà</th>
        <th style="text-align:right;padding:4px 8px">Prezzo</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
      ${shippingLine}
      <tr style="border-top:1px solid #eee;font-weight:bold">
        <td style="padding:8px 8px" colspan="2">Totale</td>
        <td style="padding:8px 8px;text-align:right">${Number(doc.total).toFixed(2)}€</td>
      </tr>
    </tbody>
  </table>

  <p style="font-size:13px;color:#555">Alessandro<br>The Foolish Butcher</p>
</body>
</html>`

  const resendKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.EMAIL_FROM || 'noreply@thefoolishbutcher.com'
  if (!resendKey) {
    console.error('[Orders] RESEND_API_KEY not set — skipping confirmation email')
    return
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `The Foolish Butcher <${fromAddress}>`,
        to: [doc.customerEmail],
        subject: `Ordine ricevuto — ${doc.orderNumber}`,
        html,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('[Orders] Resend API error:', res.status, text)
    }
  } catch (err) {
    console.error('[Orders] sendOrderConfirmation failed:', err)
  }
}

const notifyNanobot: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  const nanobotUrl = process.env.NANOBOT_WEBHOOK_URL
  if (!nanobotUrl) return

  // Notifica solo quando pipelineState cambia (o su create)
  const stateChanged =
    operation === 'create' ||
    doc.pipelineState !== previousDoc?.pipelineState

  if (!stateChanged) return

  fetch(`${nanobotUrl}/hooks/foolish-order-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderNumber: doc.orderNumber,
      pipelineState: doc.pipelineState,
      previousState: previousDoc?.pipelineState ?? null,
      customerEmail: doc.customerEmail,
      trackingNumber: doc.trackingNumber ?? null,
      trackingCarrier: doc.trackingCarrier ?? null,
      productionEtaDays: doc.productionEtaDays ?? null,
    }),
  }).catch((err) => console.error('[Orders] nanobot notify failed:', err))
}

export const Orders: CollectionConfig = {
  slug: 'orders',
  hooks: {
    afterChange: [sendOrderConfirmation, notifyNanobot],
  },
  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'customerEmail', 'pipelineState', 'total', 'createdAt'],
    group: 'Ordini',
  },
  access: {
    read: ({ req }) => {
      if (req.user) return true
      // Storefront può leggere con shared secret header
      const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
      return !!secret && secret === process.env.PAYLOAD_API_SECRET
    },
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
