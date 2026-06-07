import type { CollectionConfig, CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'
import crypto from 'crypto'

const syncCustomer: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (!doc.customerEmail) return

  const payload = req.payload
  const country = (doc.shippingAddress as Record<string, string> | undefined)?.country || undefined

  try {
    const existing = await payload.find({
      collection: 'customers',
      where: { email: { equals: doc.customerEmail } },
      limit: 1,
      depth: 0,
    })

    if (existing.docs.length === 0) {
      // Create new customer record
      await payload.create({
        collection: 'customers',
        data: {
          email: doc.customerEmail,
          name: doc.customerName || undefined,
          country: country || undefined,
          totalOrders: 1,
        },
      })
    } else {
      const customer = existing.docs[0] as unknown as Record<string, unknown>
      const currentTotal = (customer.totalOrders as number) ?? 0
      await payload.update({
        collection: 'customers',
        id: customer.id as string,
        data: {
          ...(doc.customerName && !customer.name ? { name: doc.customerName } : {}),
          ...(country && !customer.country ? { country } : {}),
          ...(operation === 'create' ? { totalOrders: currentTotal + 1 } : {}),
        },
      })
    }
  } catch (err) {
    console.error('[Orders] syncCustomer failed:', err)
  }
}

const generatePageToken: CollectionBeforeChangeHook = async ({ data, operation }) => {
  if (operation === 'create' && !data.pageToken) {
    data.pageToken = crypto.randomUUID()
  }
  return data
}

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

  const firstName = (doc.customerName ?? '').split(' ')[0] || 'cliente'

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">Conferma ordine</h2>
  <p style="color:#555;margin-top:0">Riferimento: <strong>${doc.orderNumber}</strong></p>

  <p>Ciao ${firstName},</p>
  <p>Abbiamo ricevuto il tuo ordine. Trovi il riepilogo qui sotto.</p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <thead>
      <tr style="border-bottom:1px solid #eee">
        <th style="text-align:left;padding:6px 8px">Prodotto</th>
        <th style="text-align:center;padding:6px 8px">Qtà</th>
        <th style="text-align:right;padding:6px 8px">Prezzo</th>
      </tr>
    </thead>
    <tbody>
      ${itemsHtml}
      ${shippingLine}
      <tr style="border-top:2px solid #eee;font-weight:bold">
        <td style="padding:8px" colspan="2">Totale</td>
        <td style="text-align:right;padding:8px">${Number(doc.total).toFixed(2)} €</td>
      </tr>
    </tbody>
  </table>

  <p style="margin-top:24px;font-size:13px;color:#555">The Foolish Butcher</p>
</body>
</html>`

  const resendKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.EMAIL_FROM || 'ordini@updates.thefoolishbutcher.com'
  // Ensure "Name <email>" format — EMAIL_FROM may be just the address
  const fromAddress = emailFrom.includes('<') ? emailFrom : `The Foolish Butcher <${emailFrom}>`
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
        from: fromAddress,
        to: [doc.customerEmail],
        subject: `Ordine ricevuto — ${doc.orderNumber}`,
        html,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('[Orders] Resend API error:', res.status, text)
    } else {
      console.log('[Orders] Confirmation email sent to', doc.customerEmail, 'order', doc.orderNumber)
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
    beforeChange: [generatePageToken],
    afterChange: [sendOrderConfirmation, notifyNanobot, syncCustomer],
  },
  admin: {
    useAsTitle: 'orderNumber',
    defaultColumns: ['orderNumber', 'customerEmail', 'pipelineState', 'total', 'createdAt'],
    listSearchableFields: ['orderNumber', 'customerEmail', 'customerName'],
    group: 'Ordini',
    preview: (doc) => {
      const token = (doc as Record<string, unknown>).pageToken as string | undefined
      return token ? `https://thefoolishbutcher.com/ordine/${token}` : null
    },
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
      type: 'tabs',
      tabs: [
        {
          label: 'Ordine',
          fields: [
            {
              name: 'orderNumber',
              type: 'text',
              required: true,
              unique: true,
              label: 'Numero ordine',
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
              name: 'productionEtaDays',
              type: 'number',
              label: 'ETA produzione (giorni)',
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
              name: 'notes',
              type: 'textarea',
              label: 'Note interne',
            },
          ],
        },
        {
          label: 'Spedizione',
          fields: [
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
              name: 'trackingNumber',
              type: 'text',
              label: 'Tracking spedizione',
            },
            {
              name: 'trackingCarrier',
              type: 'text',
              label: 'Corriere',
            },
          ],
        },
        {
          label: 'Contenuti',
          fields: [
            {
              name: 'sheetPhotos',
              type: 'array',
              label: 'Foto fogli',
              admin: { description: 'Foto dei fogli fisici abbinati a questo ordine.' },
              fields: [
                { name: 'url', type: 'text', required: true, label: 'URL foto' },
                { name: 'caption', type: 'text', label: 'Didascalia (es. A4 — flock denso, discromia ocra)' },
              ],
            },
            {
              name: 'contentBlocks',
              type: 'array',
              label: 'Blocchi contenuto (pagina cliente)',
              admin: { description: 'Frank popola questi blocchi: guide, offerte, annunci. Visibili nella pagina cliente.' },
              fields: [
                {
                  name: 'type',
                  type: 'select',
                  required: true,
                  label: 'Tipo',
                  options: [
                    { label: 'Guida tecnica', value: 'guide' },
                    { label: 'Annuncio produzione', value: 'announcement' },
                    { label: 'Offerta', value: 'offer' },
                    { label: 'Suggerimento', value: 'tip' },
                  ],
                },
                { name: 'title', type: 'text', required: true, label: 'Titolo' },
                { name: 'body', type: 'textarea', required: true, label: 'Testo' },
                { name: 'ctaLabel', type: 'text', label: 'Testo CTA (opzionale)' },
                { name: 'ctaUrl', type: 'text', label: 'URL CTA (opzionale)' },
                { name: 'active', type: 'checkbox', defaultValue: true, label: 'Visibile' },
                { name: 'expiresAt', type: 'date', label: 'Scade il (opzionale)' },
              ],
            },
          ],
        },
        {
          label: 'Avanzate',
          fields: [
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
              name: 'customerLocale',
              type: 'text',
              label: 'Lingua cliente (es. it, en, de)',
              admin: { description: 'Codice ISO 639-1. Usato per localizzare la pagina cliente.' },
            },
            {
              name: 'pageToken',
              type: 'text',
              unique: true,
              label: 'Token pagina cliente',
              admin: {
                readOnly: true,
                description: 'UUID generato automaticamente. Usato come URL sicuro per la pagina cliente.',
              },
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
          ],
        },
      ],
    },
  ],
  timestamps: true,
}
