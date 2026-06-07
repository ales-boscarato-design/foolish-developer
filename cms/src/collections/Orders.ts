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

const notifyAlessandroByEmail: CollectionAfterChangeHook = async ({ doc, operation }) => {
  if (operation !== 'create') return

  const resendKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ADMIN_EMAIL
  if (!resendKey || !adminEmail) return

  const emailFrom = process.env.EMAIL_FROM || 'ordini@updates.thefoolishbutcher.com'
  const fromAddress = emailFrom.includes('<') ? emailFrom : `The Foolish Butcher <${emailFrom}>`

  const items: Array<{ name: string; variantLabel: string; quantity: number; unitPrice: number }> =
    Array.isArray(doc.lineItems) ? doc.lineItems : []

  const itemsText = items
    .map((i) => `• ${i.quantity}× ${i.name} ${i.variantLabel} — ${(i.unitPrice * i.quantity).toFixed(2)}€`)
    .join('\n')

  const addr = doc.shippingAddress as Record<string, string> | undefined
  const addressText = addr
    ? `${addr.name}, ${addr.address1}${addr.address2 ? ' ' + addr.address2 : ''}, ${addr.postalCode} ${addr.city} (${addr.country})`
    : '—'

  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
  const orderLink = `${cmsUrl}/admin/collections/orders/${doc.id}`

  const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;color:#111;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">🛒 Nuovo ordine ricevuto</h2>
  <p style="color:#555;margin-top:0">Riferimento: <strong>${doc.orderNumber}</strong></p>

  <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
    <tr><td style="padding:4px 0;color:#555;width:140px">Cliente</td><td><strong>${doc.customerName ?? '—'}</strong></td></tr>
    <tr><td style="padding:4px 0;color:#555">Email</td><td>${doc.customerEmail}</td></tr>
    <tr><td style="padding:4px 0;color:#555">Indirizzo</td><td>${addressText}</td></tr>
    <tr><td style="padding:4px 0;color:#555">Totale</td><td><strong>${Number(doc.total).toFixed(2)} €</strong>${doc.shippingCost > 0 ? ` (di cui ${Number(doc.shippingCost).toFixed(2)}€ spedizione)` : ' — spedizione gratuita'}</td></tr>
  </table>

  <p style="font-size:14px;margin:8px 0 4px"><strong>Prodotti:</strong></p>
  <pre style="font-size:13px;background:#f5f5f5;padding:12px;border-radius:6px;margin:0">${itemsText}</pre>

  <p style="margin-top:24px">
    <a href="${orderLink}" style="background:#111;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px">
      Apri ordine nel CMS →
    </a>
  </p>
</body>
</html>`

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [adminEmail],
        subject: `🛒 Nuovo ordine ${doc.orderNumber} — ${Number(doc.total).toFixed(2)}€`,
        html,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('[Orders] Admin notification email error:', res.status, text)
    } else {
      console.log('[Orders] Admin notification sent to', adminEmail, 'order', doc.orderNumber)
    }
  } catch (err) {
    console.error('[Orders] notifyAlessandroByEmail failed:', err)
  }
}

export const Orders: CollectionConfig = {
  slug: 'orders',
  hooks: {
    beforeChange: [generatePageToken],
    afterChange: [sendOrderConfirmation, notifyNanobot, notifyAlessandroByEmail, syncCustomer],
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
    // ── Intestazione ──────────────────────────────────────────────
    {
      type: 'row',
      fields: [
        {
          name: 'orderNumber',
          type: 'text',
          required: true,
          unique: true,
          label: 'Numero ordine',
          admin: { width: '50%' },
        },
        {
          name: 'pipelineState',
          type: 'select',
          defaultValue: 'received',
          label: 'Stato',
          admin: { width: '50%' },
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
      ],
    },

    // ── Cliente ───────────────────────────────────────────────────
    {
      type: 'row',
      fields: [
        { name: 'customerEmail', type: 'email', required: true, label: 'Email cliente', admin: { width: '50%' } },
        { name: 'customerName', type: 'text', label: 'Nome cliente', admin: { width: '50%' } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'customerTelegramId', type: 'text', label: 'Telegram ID cliente', admin: { width: '50%' } },
        { name: 'customerLocale', type: 'text', label: 'Lingua (es. it, en)', admin: { width: '50%' } },
      ],
    },

    // ── Importi ───────────────────────────────────────────────────
    {
      type: 'row',
      fields: [
        { name: 'total', type: 'number', required: true, label: 'Totale (€)', admin: { width: '33%' } },
        { name: 'shippingCost', type: 'number', label: 'Spedizione (€)', admin: { width: '33%' } },
        { name: 'productionEtaDays', type: 'number', label: 'ETA produzione (giorni)', admin: { width: '33%' } },
      ],
    },

    // ── Prodotti ordinati ─────────────────────────────────────────
    {
      name: 'lineItems',
      type: 'json',
      required: true,
      label: 'Prodotti ordinati',
    },

    // ── Spedizione ────────────────────────────────────────────────
    {
      type: 'collapsible',
      label: 'Spedizione e tracking',
      admin: { initCollapsed: false },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'trackingNumber', type: 'text', label: 'Tracking', admin: { width: '50%' } },
            { name: 'trackingCarrier', type: 'text', label: 'Corriere', admin: { width: '50%' } },
          ],
        },
        {
          name: 'shippingAddress',
          type: 'group',
          label: 'Indirizzo spedizione',
          fields: [
            { name: 'name', type: 'text', label: 'Nome' },
            { type: 'row', fields: [
              { name: 'address1', type: 'text', label: 'Via/Piazza', admin: { width: '70%' } },
              { name: 'address2', type: 'text', label: 'Interno', admin: { width: '30%' } },
            ]},
            { type: 'row', fields: [
              { name: 'city', type: 'text', label: 'Città', admin: { width: '40%' } },
              { name: 'postalCode', type: 'text', label: 'CAP', admin: { width: '30%' } },
              { name: 'country', type: 'text', label: 'Paese', admin: { width: '30%' } },
            ]},
          ],
        },
      ],
    },

    // ── Note ─────────────────────────────────────────────────────
    {
      name: 'notes',
      type: 'textarea',
      label: 'Note interne (solo Alessandro)',
    },

    // ── Dati fatturazione ─────────────────────────────────────────
    {
      type: 'collapsible',
      label: 'Dati fatturazione',
      admin: {
        initCollapsed: false,
        description: 'Compilare per generare fattura. Se uguale alla spedizione lasciare vuoto.',
      },
      fields: [
        {
          name: 'billingSameAsShipping',
          type: 'checkbox',
          defaultValue: true,
          label: 'Indirizzo fatturazione = indirizzo spedizione',
        },
        {
          type: 'row',
          fields: [
            { name: 'billingCompanyName', type: 'text', label: 'Ragione sociale', admin: { width: '50%' } },
            { name: 'billingVatNumber', type: 'text', label: 'P.IVA / Codice Fiscale', admin: { width: '30%', description: 'IT12345678901' } },
            { name: 'billingSdiCode', type: 'text', label: 'Codice SDI', admin: { width: '20%', description: 'Es. 0000000' } },
          ],
        },
        {
          name: 'billingAddress',
          type: 'group',
          label: 'Indirizzo fatturazione (se diverso)',
          admin: {
            condition: (data) => data.billingSameAsShipping === false,
          },
          fields: [
            { name: 'name', type: 'text', label: 'Intestatario' },
            { type: 'row', fields: [
              { name: 'address1', type: 'text', label: 'Via/Piazza', admin: { width: '70%' } },
              { name: 'address2', type: 'text', label: 'Interno', admin: { width: '30%' } },
            ]},
            { type: 'row', fields: [
              { name: 'city', type: 'text', label: 'Città', admin: { width: '40%' } },
              { name: 'postalCode', type: 'text', label: 'CAP', admin: { width: '30%' } },
              { name: 'country', type: 'text', label: 'Paese', admin: { width: '30%' } },
            ]},
          ],
        },
      ],
    },

    // ── Foto fogli ────────────────────────────────────────────────
    {
      type: 'collapsible',
      label: 'Foto fogli abbinati',
      admin: { initCollapsed: true },
      fields: [
        {
          name: 'sheetPhotos',
          type: 'array',
          label: 'Foto',
          admin: { description: 'Foto dei fogli fisici abbinati a questo ordine.' },
          fields: [
            { name: 'url', type: 'text', required: true, label: 'URL foto' },
            { name: 'caption', type: 'text', label: 'Didascalia' },
          ],
        },
      ],
    },

    // ── Blocchi pagina cliente ────────────────────────────────────
    {
      type: 'collapsible',
      label: 'Blocchi pagina cliente',
      admin: { initCollapsed: true, description: 'Frank popola questi blocchi: guide, offerte, annunci.' },
      fields: [
        {
          name: 'contentBlocks',
          type: 'array',
          label: 'Blocchi',
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
            { type: 'row', fields: [
              { name: 'ctaLabel', type: 'text', label: 'CTA testo', admin: { width: '50%' } },
              { name: 'ctaUrl', type: 'text', label: 'CTA URL', admin: { width: '50%' } },
            ]},
            { name: 'active', type: 'checkbox', defaultValue: true, label: 'Visibile' },
            { name: 'expiresAt', type: 'date', label: 'Scade il (opzionale)' },
          ],
        },
      ],
    },

    // ── Campi tecnici (nascosti) ──────────────────────────────────
    {
      type: 'collapsible',
      label: 'Dati tecnici',
      admin: { initCollapsed: true },
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
        { name: 'pageToken', type: 'text', unique: true, label: 'Token pagina cliente', admin: { readOnly: true } },
        { name: 'revolutOrderId', type: 'text', label: 'Revolut Order ID', admin: { readOnly: true } },
        { name: 'revolutStatus', type: 'text', label: 'Revolut Status', admin: { readOnly: true } },
      ],
    },
  ],
  timestamps: true,
}
