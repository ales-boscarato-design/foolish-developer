import { Resend } from 'resend'
import { notifyNanobot } from '@/lib/nanobot'
import type { StripeOrderReconciliationResult } from '@/lib/stripe-orders'

type ReconciliationAlert = (
  | { eventType: 'stripe_order_reconciliation' | 'stripe_order_reconciliation_heartbeat'; result: StripeOrderReconciliationResult }
  | { eventType: 'stripe_order_reconciliation_fatal'; error: string }
)

async function sendAdminEmail(alert: ReconciliationAlert): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ADMIN_EMAIL
  if (!apiKey || !adminEmail) {
    throw new Error('Stripe reconciliation email unavailable: RESEND_API_KEY or ADMIN_EMAIL is not configured')
  }

  const from = process.env.RESEND_FROM || 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
  const isFatal = alert.eventType === 'stripe_order_reconciliation_fatal'
  const recovered = isFatal ? 0 : alert.result.recovered.length
  const errors = isFatal ? 1 : alert.result.errors.length
  const subject = isFatal || errors > 0
    ? `[URGENTE] Controllo ordini Stripe fallito (${errors} errori)`
    : recovered > 0
      ? `[Stripe] Recuperati automaticamente ${recovered} ordini`
      : '[Stripe] Audit giornaliero OK — zero ordini mancanti'

  const report = isFatal
    ? { eventType: alert.eventType, error: alert.error }
    : { eventType: alert.eventType, ...alert.result }

  const { error } = await new Resend(apiKey).emails.send({
    from,
    to: adminEmail,
    subject,
    text: [
      'Controllo automatico Stripe → CMS.',
      '',
      JSON.stringify(report, null, 2),
    ].join('\n'),
  })
  if (error) throw new Error(`Stripe reconciliation email failed: ${error.message}`)
}

export async function notifyStripeReconciliation(alert: ReconciliationAlert): Promise<void> {
  const payload = alert.eventType === 'stripe_order_reconciliation_fatal'
    ? { eventType: alert.eventType, source: 'storefront', fatal: true, error: alert.error }
    : { eventType: alert.eventType, source: 'storefront', ...alert.result }

  // Canali indipendenti: Alfred può essere irraggiungibile mentre Resend è
  // operativo (o viceversa). Il cron fallisce solo se entrambi gli allarmi
  // sono indisponibili, evitando un singolo punto di fallimento.
  const channels = await Promise.allSettled([
    notifyNanobot('/hooks/foolish-storefront-order', payload, { throwOnError: true }),
    sendAdminEmail(alert),
  ])

  const failed = channels.filter((channel) => channel.status === 'rejected')
  for (const channel of failed) {
    if (channel.status === 'rejected') {
      console.error('[stripe-reconcile] alert channel failed:', channel.reason)
    }
  }
  if (failed.length === channels.length) {
    throw new Error('All Stripe reconciliation alert channels failed')
  }
}
