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
      overrideAccess: true,
    })

    if (existing.docs.length === 0) {
      await payload.create({
        collection: 'customers',
        data: {
          email: doc.customerEmail,
          name: doc.customerName || undefined,
          country: country || undefined,
          totalOrders: 1,
        },
        overrideAccess: true,
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
        overrideAccess: true,
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

const ORDER_STRINGS: Record<string, {
  subject: string; heading: string; ref: string; greeting: string;
  body: string; product: string; qty: string; price: string;
  shipping: string; freeShipping: string; total: string;
  trackOrder: string; trackOrderBody: string;
  telegramTitle: string; telegramBody: string; telegramCta: string;
  footer: string;
}> = {
  it: {
    subject: 'Ordine ricevuto',
    heading: 'Conferma ordine',
    ref: 'Riferimento',
    greeting: 'Ciao',
    body: 'Abbiamo ricevuto il tuo ordine. Lo stiamo preparando personalmente.',
    product: 'Prodotto', qty: 'Qtà', price: 'Prezzo',
    shipping: 'Spedizione', freeShipping: 'Spedizione gratuita', total: 'Totale',
    trackOrder: 'Segui il tuo ordine →',
    trackOrderBody: 'Puoi seguire lo stato del tuo ordine in tempo reale.',
    telegramTitle: 'Aggiornamenti in tempo reale su Telegram',
    telegramBody: 'Ricevi notifiche dirette da Alessandro — foto dei fogli, tracking e aggiornamenti.',
    telegramCta: 'Apri su Telegram',
    footer: 'The Foolish Butcher · Chieri (TO), Italia · Made in Italy',
  },
  en: {
    subject: 'Order received',
    heading: 'Order confirmation',
    ref: 'Reference',
    greeting: 'Hi',
    body: 'We have received your order. We are preparing it personally.',
    product: 'Product', qty: 'Qty', price: 'Price',
    shipping: 'Shipping', freeShipping: 'Free shipping', total: 'Total',
    trackOrder: 'Track your order →',
    trackOrderBody: 'You can follow your order status in real time.',
    telegramTitle: 'Real-time updates on Telegram',
    telegramBody: 'Get direct updates from Alessandro — sheet photos, tracking and updates.',
    telegramCta: 'Open on Telegram',
    footer: 'The Foolish Butcher · Chieri (TO), Italy · Made in Italy',
  },
  de: {
    subject: 'Bestellung eingegangen',
    heading: 'Bestellbestätigung',
    ref: 'Referenz',
    greeting: 'Hallo',
    body: 'Wir haben Ihre Bestellung erhalten und bereiten sie persönlich vor.',
    product: 'Produkt', qty: 'Menge', price: 'Preis',
    shipping: 'Versand', freeShipping: 'Kostenloser Versand', total: 'Gesamt',
    trackOrder: 'Bestellung verfolgen →',
    trackOrderBody: 'Sie können den Status Ihrer Bestellung in Echtzeit verfolgen.',
    telegramTitle: 'Echtzeit-Updates auf Telegram',
    telegramBody: 'Erhalten Sie direkte Updates von Alessandro — Fotos, Tracking und mehr.',
    telegramCta: 'Auf Telegram öffnen',
    footer: 'The Foolish Butcher · Chieri (TO), Italien · Made in Italy',
  },
  fr: {
    subject: 'Commande reçue',
    heading: 'Confirmation de commande',
    ref: 'Référence',
    greeting: 'Bonjour',
    body: 'Nous avons bien reçu votre commande et la préparons personnellement.',
    product: 'Produit', qty: 'Qté', price: 'Prix',
    shipping: 'Livraison', freeShipping: 'Livraison gratuite', total: 'Total',
    trackOrder: 'Suivre ma commande →',
    trackOrderBody: 'Vous pouvez suivre l\'état de votre commande en temps réel.',
    telegramTitle: 'Mises à jour en temps réel sur Telegram',
    telegramBody: 'Recevez des messages directs d\'Alessandro — photos, suivi et mises à jour.',
    telegramCta: 'Ouvrir sur Telegram',
    footer: 'The Foolish Butcher · Chieri (TO), Italie · Made in Italy',
  },
  es: {
    subject: 'Pedido recibido',
    heading: 'Confirmación de pedido',
    ref: 'Referencia',
    greeting: 'Hola',
    body: 'Hemos recibido tu pedido y lo estamos preparando personalmente.',
    product: 'Producto', qty: 'Cant.', price: 'Precio',
    shipping: 'Envío', freeShipping: 'Envío gratuito', total: 'Total',
    trackOrder: 'Seguir mi pedido →',
    trackOrderBody: 'Puedes seguir el estado de tu pedido en tiempo real.',
    telegramTitle: 'Actualizaciones en tiempo real en Telegram',
    telegramBody: 'Recibe mensajes directos de Alessandro — fotos, tracking y actualizaciones.',
    telegramCta: 'Abrir en Telegram',
    footer: 'The Foolish Butcher · Chieri (TO), Italia · Made in Italy',
  },
}

const sendOrderConfirmation: CollectionAfterChangeHook = async ({ doc, operation }) => {
  if (operation !== 'create') return
  if (!doc.customerEmail) return

  const locale = (doc.customerLocale as string | null) ?? 'it'
  const t = ORDER_STRINGS[locale] ?? ORDER_STRINGS['en']!

  const items: Array<{ name: string; variantLabel: string; quantity: number; unitPrice: number }> =
    Array.isArray(doc.lineItems) ? doc.lineItems : []

  const storefrontUrl = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'
  const trackingUrl = doc.pageToken ? `${storefrontUrl}/ordine/${doc.pageToken}` : null
  const telegramUrl = doc.orderNumber
    ? `https://t.me/the_foolish_butcher_bot?start=order_${doc.orderNumber}`
    : 'https://t.me/the_foolish_butcher_bot'

  const firstName = (doc.customerName ?? '').split(' ')[0] || ''

  const itemsHtml = items.map((i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #1e1a14;color:#c9c0b0;font-size:14px">
        ${i.name}${i.variantLabel ? ` <span style="color:#6b5f4a">— ${i.variantLabel}</span>` : ''}
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #1e1a14;text-align:center;color:#6b5f4a;font-size:14px">×${i.quantity}</td>
      <td style="padding:10px 0;border-bottom:1px solid #1e1a14;text-align:right;color:#c9c0b0;font-size:14px">${(i.unitPrice * i.quantity).toFixed(2)}€</td>
    </tr>`).join('')

  const shippingRow = doc.shippingCost > 0
    ? `<tr>
        <td colspan="2" style="padding:8px 0;color:#6b5f4a;font-size:13px">${t.shipping}</td>
        <td style="padding:8px 0;text-align:right;color:#6b5f4a;font-size:13px">${Number(doc.shippingCost).toFixed(2)}€</td>
       </tr>`
    : `<tr><td colspan="3" style="padding:8px 0;color:#4caf50;font-size:13px">✓ ${t.freeShipping}</td></tr>`

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0b08;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0b08;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

      <!-- Header -->
      <tr>
        <td style="border-bottom:1px solid #2a2318;padding-bottom:20px;margin-bottom:20px">
          <p style="margin:0;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6b5f4a">THE FOOLISH BUTCHER</p>
          <p style="margin:4px 0 0;font-size:11px;color:#3a3020">${t.ref}: <span style="color:#c9a96e;font-family:monospace">${doc.orderNumber}</span></p>
        </td>
      </tr>

      <!-- Greeting -->
      <tr>
        <td style="padding:28px 0 20px">
          <h1 style="margin:0 0 8px;font-size:26px;font-weight:700;color:#f0e8d8;line-height:1.2">${firstName ? `${t.greeting} ${firstName}.` : t.heading}</h1>
          <p style="margin:0;font-size:15px;color:#9a8870;line-height:1.6">${t.body}</p>
        </td>
      </tr>

      <!-- Items table -->
      <tr>
        <td style="background:#13110e;border-radius:6px;padding:4px 20px 12px">
          <table width="100%" cellpadding="0" cellspacing="0">
            <thead>
              <tr>
                <th style="text-align:left;padding:12px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b5f4a;font-weight:500">${t.product}</th>
                <th style="text-align:center;padding:12px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b5f4a;font-weight:500;width:40px">${t.qty}</th>
                <th style="text-align:right;padding:12px 0 8px;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#6b5f4a;font-weight:500">${t.price}</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
              ${shippingRow}
              <tr>
                <td colspan="2" style="padding:12px 0 4px;font-size:15px;font-weight:700;color:#f0e8d8">${t.total}</td>
                <td style="padding:12px 0 4px;text-align:right;font-size:18px;font-weight:700;color:#c9a96e">${Number(doc.total).toFixed(2)} €</td>
              </tr>
            </tbody>
          </table>
        </td>
      </tr>

      ${trackingUrl ? `
      <!-- Track order CTA -->
      <tr>
        <td style="padding:28px 0 0">
          <p style="margin:0 0 10px;font-size:13px;color:#6b5f4a">${t.trackOrderBody}</p>
          <a href="${trackingUrl}"
             style="display:inline-block;background:#c9a96e;color:#0d0b08;padding:12px 24px;border-radius:4px;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:0.02em">
            ${t.trackOrder}
          </a>
        </td>
      </tr>` : ''}

      <!-- Telegram CTA -->
      <tr>
        <td style="padding:24px 0 0">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#13110e;border-radius:6px;padding:0">
            <tr>
              <td style="padding:18px 20px">
                <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#f0e8d8">${t.telegramTitle}</p>
                <p style="margin:0 0 14px;font-size:13px;color:#6b5f4a;line-height:1.5">${t.telegramBody}</p>
                <a href="${telegramUrl}"
                   style="display:inline-flex;align-items:center;gap:8px;background:#229ED9;color:#fff;padding:9px 18px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:600">
                  ${t.telegramCta}
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:32px 0 0;border-top:1px solid #1a1510;margin-top:32px">
          <p style="margin:0;font-size:11px;color:#3a3020;text-align:center">${t.footer}</p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`

  const resendKey = process.env.RESEND_API_KEY
  const emailFrom = process.env.EMAIL_FROM || 'ordini@updates.thefoolishbutcher.com'
  const fromAddress = emailFrom.includes('<') ? emailFrom : `The Foolish Butcher <${emailFrom}>`
  if (!resendKey) {
    console.error('[Orders] RESEND_API_KEY not set — skipping confirmation email')
    return
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromAddress,
        to: [doc.customerEmail],
        subject: `${t.subject} — ${doc.orderNumber}`,
        html,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('[Orders] Resend API error:', res.status, text)
    } else {
      console.log('[Orders] Confirmation email sent to', doc.customerEmail, 'locale', locale, 'order', doc.orderNumber)
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
      customerLocale: doc.customerLocale ?? 'it',
      customerTelegramId: doc.customerTelegramId ?? null,
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

const TRACKING_STRINGS: Record<string, {
  subject: string; heading: string; body: string;
  trackLabel: string; carrierLabel: string; footer: string;
}> = {
  it: {
    subject: 'Il tuo ordine è in viaggio',
    heading: 'Spedito!',
    body: 'Il tuo ordine è stato spedito. Puoi tracciarlo usando le informazioni qui sotto.',
    trackLabel: 'Traccia il tuo ordine →',
    carrierLabel: 'Corriere',
    footer: 'The Foolish Butcher · Chieri (TO), Italia · Made in Italy',
  },
  en: {
    subject: 'Your order is on its way',
    heading: 'Shipped!',
    body: 'Your order has been shipped. You can track it using the information below.',
    trackLabel: 'Track your order →',
    carrierLabel: 'Carrier',
    footer: 'The Foolish Butcher · Chieri (TO), Italy · Made in Italy',
  },
  de: {
    subject: 'Ihre Bestellung ist unterwegs',
    heading: 'Versendet!',
    body: 'Ihre Bestellung wurde versendet. Sie können sie mit den folgenden Informationen verfolgen.',
    trackLabel: 'Bestellung verfolgen →',
    carrierLabel: 'Transportunternehmen',
    footer: 'The Foolish Butcher · Chieri (TO), Italien · Made in Italy',
  },
  fr: {
    subject: 'Votre commande est en route',
    heading: 'Expédié !',
    body: 'Votre commande a été expédiée. Vous pouvez la suivre avec les informations ci-dessous.',
    trackLabel: 'Suivre ma commande →',
    carrierLabel: 'Transporteur',
    footer: 'The Foolish Butcher · Chieri (TO), Italie · Made in Italy',
  },
  es: {
    subject: 'Tu pedido está en camino',
    heading: '¡Enviado!',
    body: 'Tu pedido ha sido enviado. Puedes rastrearlo con la información a continuación.',
    trackLabel: 'Rastrear mi pedido →',
    carrierLabel: 'Transportista',
    footer: 'The Foolish Butcher · Chieri (TO), Italia · Made in Italy',
  },
}

const sendTrackingEmail: CollectionAfterChangeHook = async ({ doc, previousDoc, operation }) => {
  if (operation !== 'update') return
  if (!doc.trackingNumber) return
  if (previousDoc?.trackingNumber === doc.trackingNumber) return
  if (!doc.customerEmail) return

  const locale = (doc.customerLocale as string | null) ?? 'it'
  const t = TRACKING_STRINGS[locale] ?? TRACKING_STRINGS['en']!

  const resendKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM ?? 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
  if (!resendKey) return

  const storeFrontUrl = process.env.STOREFRONT_URL ?? 'https://thefoolishbutcher.com'
  const trackingUrl = `${storeFrontUrl}/ordine/${doc.pageToken}`

  const html = `
    <div style="font-family:monospace;max-width:480px;margin:0 auto;background:#0d0d0d;color:#fff;padding:32px;">
      <div style="font-size:11px;letter-spacing:2px;color:#555;text-transform:uppercase;margin-bottom:24px;">The Foolish Butcher</div>
      <h1 style="font-size:22px;font-weight:300;color:#c9a96e;margin-bottom:16px;">${t.heading}</h1>
      <p style="color:#aaa;margin-bottom:24px;">${t.body}</p>
      <div style="background:#111;border:1px solid #333;border-radius:6px;padding:16px;margin-bottom:24px;">
        <div style="color:#555;font-size:11px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${t.carrierLabel}</div>
        <div style="color:#fff;font-size:14px;font-family:monospace;">${doc.trackingCarrier ?? ''} · ${doc.trackingNumber}</div>
      </div>
      <a href="${trackingUrl}" style="display:inline-block;background:#c9a96e;color:#000;padding:12px 24px;text-decoration:none;font-weight:bold;font-size:13px;border-radius:4px;">${t.trackLabel}</a>
      <p style="color:#444;font-size:11px;margin-top:32px;">${t.footer}</p>
    </div>
  `

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: doc.customerEmail,
        subject: t.subject,
        html,
      }),
    })
  } catch (err) {
    console.error('[Orders] sendTrackingEmail error:', err)
  }
}

export const Orders: CollectionConfig = {
  slug: 'orders',
  hooks: {
    beforeChange: [generatePageToken],
    afterChange: [sendOrderConfirmation, notifyNanobot, notifyAlessandroByEmail, syncCustomer, sendTrackingEmail],
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
      const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
      return !!secret && secret === process.env.PAYLOAD_API_SECRET
    },
    create: ({ req }) => {
      if (req.user) return true
      const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
      return !!secret && secret === process.env.PAYLOAD_API_SECRET
    },
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
            { label: 'Confermato', value: 'confirmed' },
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
    { name: 'customerPhone', type: 'text', label: 'Telefono cliente' },

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
            { label: 'Rivenditore', value: 'reseller' },
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
