import { Resend } from 'resend'
import { formatPrice } from './pricing'

const FROM = 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
const getResend = () => new Resend(process.env.RESEND_API_KEY!)

export async function sendMagicLink(email: string, link: string, contactName: string) {
  await getResend().emails.send({
    from: FROM,
    to: email,
    subject: 'Accesso area rivenditori — The Foolish Butcher',
    html: `
      <p>Ciao ${contactName},</p>
      <p>Clicca il link per accedere all'area rivenditori (valido 15 minuti):</p>
      <p><a href="${link}" style="background:#1c1c1c;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">Accedi all'area rivenditori</a></p>
      <p style="color:#888;font-size:12px">Se non hai richiesto questo accesso, ignora questa email.</p>
    `,
  })
}

export async function sendOrderConfirmation(params: {
  email: string
  contactName: string
  orderNumber: string
  total: number
  paymentMethod: string
  lineItems: { name: string; qty: number; total: number }[]
}) {
  const itemsHtml = params.lineItems
    .map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${formatPrice(i.total)}</td></tr>`)
    .join('')

  const paymentNote = params.paymentMethod === 'bonifico'
    ? `<p><strong>Pagamento:</strong> Bonifico bancario. Riceverai le coordinate bancarie a breve via email.</p>`
    : `<p><strong>Pagamento:</strong> Carta di credito (Stripe). Il pagamento è stato confermato.</p>`

  await getResend().emails.send({
    from: FROM,
    to: params.email,
    bcc: ['boscaratoa@icloud.com', 'support.foolish@agentmail.to'],
    subject: `Ordine ${params.orderNumber} confermato — The Foolish Butcher`,
    html: `
      <p>Ciao ${params.contactName},</p>
      <p>Il tuo ordine <strong>${params.orderNumber}</strong> è stato ricevuto.</p>
      <table border="1" cellpadding="8" style="border-collapse:collapse;width:100%">
        <thead><tr><th>Prodotto</th><th>Qtà</th><th>Totale</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p><strong>Totale ordine: ${formatPrice(params.total)}</strong> (IVA inclusa)</p>
      ${paymentNote}
      <p>Grazie,<br/>The Foolish Butcher</p>
    `,
  })
}
