// storefront/src/lib/subscription-renewal-zone-alert.ts
//
// Consegna del segnale di `subscription-renewal-zone.ts`: una riga JSON nel log
// (strutturata, cosi' si filtra per `event`) piu' una email all'indirizzo
// admin, con lo stesso schema gia' usato per l'audit Stripe→CMS.
//
// Perche' non l'hook Telegram: il ricevitore degli avvisi non ha una rotta per
// questo evento e `/hooks/foolish-storefront-order` interpreterebbe qualunque
// payload non-reconciliation come un ordine nuovo (annunciando "ORDINE NUOVO —
// N/A"). Un avviso sbagliato e' peggio di nessun avviso: la rotta dedicata e'
// lavoro sul ricevitore, tracciato a parte.
//
// Questo modulo non deve MAI far fallire il rinnovo: ogni errore di consegna
// resta nel log e il webhook prosegue.

import { Resend } from 'resend'

import { PLAN_NAMES } from './subscription-plans'
import {
  buildRenewalZoneAlertPayload,
  type RenewalZoneAlertPayload,
  type RenewalZoneMismatch,
} from './subscription-renewal-zone'

export interface RenewalZoneAlertDeps {
  /** Canale di consegna. Iniettabile: i test non mandano email. */
  notify?: (payload: RenewalZoneAlertPayload, mismatch: RenewalZoneMismatch) => Promise<void>
  /** Dove finisce la riga strutturata. Iniettabile per leggere il log nei test. */
  logger?: (line: string) => void
}

const REASON_TEXT: Record<RenewalZoneAlertPayload['reason'], string> = {
  zone_changed: 'la destinazione della fattura e\' in un\'altra zona della scala',
  destination_unknown: 'la fattura non riporta il paese di destinazione',
  destination_outside_subscription_zones: 'la destinazione e\' fuori dalle zone dell\'abbonamento',
  registered_zone_invalid: 'la zona registrata non e\' una zona della scala (IT/EU)',
}

function money(value: number | null): string {
  return value === null ? 'non calcolabile' : `${value.toFixed(2)} EUR`
}

function alertText(payload: RenewalZoneAlertPayload): string {
  const lines = [
    'Rinnovo abbonamento con una zona che non corrisponde alla destinazione della fattura.',
    '',
    `Subscription: ${payload.subscriptionId}`,
    `Piano: ${PLAN_NAMES[payload.plan]} — ciclo ${payload.cycle}`,
    `Zona registrata: ${payload.registeredZone}`,
    `Zona della destinazione: ${payload.destinationZone}${payload.destinationCountry ? ` (paese ${payload.destinationCountry})` : ''}`,
    `Motivo: ${REASON_TEXT[payload.reason]}`,
    '',
    `Spedizione registrata: ${money(payload.registeredShipping)}`,
    `Spedizione della destinazione: ${money(payload.destinationShipping)}`,
    `Differenza per ciclo: ${money(payload.shippingDelta)} (positivo = si incassa meno del dovuto)`,
    '',
    'Nessuna correzione automatica: la zona si cambia solo con il consenso del cliente.',
    'Il rinnovo e\' stato registrato regolarmente.',
  ]
  return lines.join('\n')
}

export async function sendRenewalZoneAlertEmail(payload: RenewalZoneAlertPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const adminEmail = process.env.ADMIN_EMAIL
  if (!apiKey || !adminEmail) {
    throw new Error('Renewal zone alert email unavailable: RESEND_API_KEY or ADMIN_EMAIL is not configured')
  }

  const from = process.env.RESEND_FROM || 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
  const { error } = await new Resend(apiKey).emails.send({
    from,
    to: adminEmail,
    subject: `[Abbonamenti] Rinnovo a zona diversa — ${payload.subscriptionId}`,
    text: alertText(payload),
  })
  if (error) throw new Error(`Renewal zone alert email failed: ${error.message}`)
}

/**
 * Segnala una divergenza di zona al rinnovo. `null` = zone coerenti, niente da
 * dire. Non lancia mai: il rinnovo gia' pagato non si blocca per un avviso.
 */
export async function reportRenewalZoneMismatch(
  mismatch: RenewalZoneMismatch | null,
  deps: RenewalZoneAlertDeps = {},
): Promise<void> {
  if (!mismatch) return

  const payload = buildRenewalZoneAlertPayload(mismatch)
  const log = deps.logger ?? ((line: string) => console.error(line))

  log(JSON.stringify(payload))

  try {
    await (deps.notify ?? sendRenewalZoneAlertEmail)(payload, mismatch)
  } catch (err) {
    log(JSON.stringify({
      event: 'subscription_renewal_zone_alert_failed',
      subscriptionId: payload.subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    }))
  }
}
