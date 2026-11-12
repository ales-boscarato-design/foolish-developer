// storefront/src/lib/subscription-renewal-zone-alert.ts
//
// Consegna del segnale di `subscription-renewal-zone.ts` su DUE canali
// indipendenti, piu' la riga JSON nel log:
//   - email all'indirizzo admin (traccia durevole, stesso schema gia' usato per
//     l'audit Stripe→CMS);
//   - avviso nel topic `payments` via `notifyNanobot`, sulla rotta dedicata
//     `/hooks/foolish-subscription-zone` del ricevitore.
//
// Perche' la rotta dedicata e non `/hooks/foolish-storefront-order`: quel
// handler interpreta qualunque payload non-reconciliation come un ordine nuovo
// e annuncerebbe «ORDINE NUOVO — N/A». Un avviso sbagliato e' peggio di nessun
// avviso.
//
// Due canali perche' cadono per motivi diversi: l'email e' la traccia che resta,
// il topic Telegram e' quello che si legge subito. Se uno dei due e' giu',
// l'altro deve partire lo stesso. La deduplica (un avviso al giorno per
// abbonamento+motivo) sta nel ricevitore, non qui: il negozio puo' segnalare
// ogni occorrenza senza allagare il topic.
//
// Questo modulo non deve MAI far fallire il rinnovo: ogni errore di consegna
// resta nel log e il webhook prosegue.

import { Resend } from 'resend'

import { notifyNanobot } from './nanobot'
import { PLAN_NAMES } from './subscription-plans'
import {
  buildRenewalZoneAlertPayload,
  type RenewalZoneAlertPayload,
  type RenewalZoneMismatch,
} from './subscription-renewal-zone'

/** Rotta del ricevitore degli avvisi (`hermes-receiver/receiver.py`, ROUTES). */
export const RENEWAL_ZONE_HOOK = '/hooks/foolish-subscription-zone'

/** Un canale di consegna: riceve il payload gia' pronto e lancia se fallisce. */
export type RenewalZoneAlertChannel = (payload: RenewalZoneAlertPayload) => Promise<void>

export interface RenewalZoneAlertDeps {
  /** Canale di consegna. Iniettabile: i test non mandano email ne' Telegram. */
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
 * Avviso nel topic `payments` del bot Telegram, attraverso il ricevitore.
 *
 * `throwOnError` + timeout: `notifyNanobot` senza `throwOnError` ingoia l'errore
 * e un try/catch attorno alla chiamata sarebbe codice morto. Il timeout (3 s)
 * impedisce che un ricevitore appeso allunghi il webhook Stripe: il rinnovo e'
 * gia' pagato e non aspetta un avviso.
 */
export async function sendRenewalZoneAlertTelegram(payload: RenewalZoneAlertPayload): Promise<void> {
  await notifyNanobot(RENEWAL_ZONE_HOOK, payload, {
    throwOnError: true,
    signal: AbortSignal.timeout(3000),
  })
}

/** I canali attivi in produzione, con il nome che finisce nel log di errore. */
export const RENEWAL_ZONE_ALERT_CHANNELS: ReadonlyArray<{ name: string; send: RenewalZoneAlertChannel }> = [
  { name: 'email', send: sendRenewalZoneAlertEmail },
  { name: 'telegram', send: sendRenewalZoneAlertTelegram },
]

/**
 * Consegna su tutti i canali senza che il primo che cade spenga gli altri.
 * Lancia un solo errore che nomina i canali falliti; chi chiama lo logga.
 */
export async function deliverRenewalZoneAlert(
  payload: RenewalZoneAlertPayload,
  channels: ReadonlyArray<{ name: string; send: RenewalZoneAlertChannel }> = RENEWAL_ZONE_ALERT_CHANNELS,
): Promise<void> {
  const results = await Promise.allSettled(channels.map((channel) => channel.send(payload)))
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          `${channels[index].name}: ${
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          }`,
        ]
      : [],
  )
  if (failures.length > 0) {
    throw new Error(`Renewal zone alert delivery failed (${failures.join('; ')})`)
  }
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
    await (deps.notify ?? ((alert: RenewalZoneAlertPayload) => deliverRenewalZoneAlert(alert)))(payload, mismatch)
  } catch (err) {
    log(JSON.stringify({
      event: 'subscription_renewal_zone_alert_failed',
      subscriptionId: payload.subscriptionId,
      error: err instanceof Error ? err.message : String(err),
    }))
  }
}
