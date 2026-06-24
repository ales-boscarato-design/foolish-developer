import { Resend } from 'resend'
import { formatPrice } from './pricing'

const FROM = 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
const FRANK_BCC = 'support.foolish@agentmail.to'
const CATALOG_URL = 'https://rivenditori.thefoolishbutcher.com/catalogo'

const getResend = () => new Resend(process.env.RESEND_API_KEY!)

export async function sendWelcomeEmail(email: string, businessName: string): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: email,
    bcc: [FRANK_BCC],
    subject: 'Benvenuto nell\'area rivenditori — The Foolish Butcher',
    html: `
      <p>Benvenuto nell'area rivenditori di The Foolish Butcher!</p>
      <p>Il tuo account per <strong>${businessName}</strong> è stato creato con successo.</p>
      <p>
        <a href="${CATALOG_URL}" style="background:#1c1c1c;color:#fff;padding:12px 24px;text-decoration:none;border-radius:4px;display:inline-block">
          Accedi al catalogo
        </a>
      </p>
      <p>Per qualsiasi necessità scrivici a <a href="mailto:ordini@thefoolishbutcher.com">ordini@thefoolishbutcher.com</a>.</p>
      <p>The Foolish Butcher</p>
    `,
  })
}

export async function sendActivationNotification(email: string, businessName: string): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: FRANK_BCC,
    subject: `Rivenditore attivato: ${businessName}`,
    html: `
      <p>Il rivenditore <strong>${businessName}</strong> (<code>${email}</code>) ha impostato la propria password e attivato l'accesso all'area rivenditori.</p>
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
    bcc: ['boscaratoa@icloud.com', FRANK_BCC],
    subject: `Ordine ${params.orderNumber} confermato — The Foolish Butcher`,
    html: `
      <p>Ciao ${params.contactName || 'rivenditore'},</p>
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
