import { Resend } from 'resend'

const FROM = 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
const FRANK_BCC = 'support.foolish@agentmail.to'
const CATALOG_URL = 'https://rivenditori.thefoolishbutcher.com/catalogo'

const getResend = () => new Resend(process.env.RESEND_API_KEY!)

export async function sendWelcomeEmail(email: string, businessName: string): Promise<void> {
  const { error } = await getResend().emails.send({
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

  if (error) {
    throw new Error(`Resend welcome email failed: ${error.message}`)
  }
}

export async function sendActivationNotification(email: string, businessName: string): Promise<void> {
  const { error } = await getResend().emails.send({
    from: FROM,
    to: FRANK_BCC,
    subject: `Rivenditore attivato: ${businessName}`,
    html: `
      <p>Il rivenditore <strong>${businessName}</strong> (<code>${email}</code>) ha impostato la propria password e attivato l'accesso all'area rivenditori.</p>
    `,
  })

  if (error) {
    throw new Error(`Resend activation notification failed: ${error.message}`)
  }
}
