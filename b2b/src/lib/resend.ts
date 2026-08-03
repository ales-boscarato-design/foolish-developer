import { Resend } from 'resend'
import { formatPrice } from './pricing'
import { getBankDetails } from './bank'

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

  // Le coordinate vanno nell'email, non solo nella pagina di conferma: chi
  // chiude la pagina senza copiare l'IBAN altrimenti resta senza. Prima qui
  // c'era la promessa di una seconda email che nessuno inviava mai.
  const banca = params.paymentMethod === 'bonifico' ? getBankDetails() : null

  const bonificoNote = banca
    ? `<p><strong>Pagamento:</strong> Bonifico bancario. Queste le coordinate:</p>
       <table cellpadding="6" style="border-collapse:collapse;background:#faf8f5;border:1px solid #e8e0d5;border-radius:4px">
         <tr><td style="color:#6b6b6b">Intestatario</td><td><strong>${banca.intestatario}</strong></td></tr>
         <tr><td style="color:#6b6b6b">IBAN</td><td><strong style="font-family:monospace;letter-spacing:0.5px">${banca.iban}</strong></td></tr>
         <tr><td style="color:#6b6b6b">Causale</td><td><strong>${params.orderNumber}</strong></td></tr>
       </table>
       <p style="font-size:13px;color:#6b6b6b">Indica il numero d'ordine come causale, così possiamo abbinare subito il pagamento.</p>`
    : `<p><strong>Pagamento:</strong> Bonifico bancario. Scrivici a <a href="mailto:ordini@thefoolishbutcher.com">ordini@thefoolishbutcher.com</a> indicando il numero d'ordine e ti inviamo subito le coordinate.</p>`

  const paymentNote = params.paymentMethod === 'bonifico'
    ? bonificoNote
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
