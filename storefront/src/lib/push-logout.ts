/**
 * Perche' esiste: la sottoscrizione push e' legata all'origine del browser, non
 * alla sessione. Al logout la sessione muore ma l'endpoint resta vivo; su un
 * dispositivo condiviso, dopo il logout di A e il login di B, il server
 * continuerebbe a inviare a quell'endpoint i dati personali di A. Qui il client
 * disiscrive il browser PRIMA della POST di logout, cosi' quel dispositivo smette
 * subito di accettare payload. Il server azzera il proprio record in modo
 * indipendente (vedi logout-session.ts): se il browser non ha service worker,
 * il record viene azzerato lo stesso.
 */

export type PushUnsubscribeOutcome = 'unsubscribed' | 'none' | 'unsupported' | 'failed'

export interface PushSubscriptionLike {
  unsubscribe(): Promise<boolean> | boolean
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>
}

export interface PushLogoutEnvironment {
  /** push manager del service worker attivo, o null se il browser non espone push */
  getPushManager?: () => Promise<PushManagerLike | null>
}

async function browserPushManager(): Promise<PushManagerLike | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    // Mai `serviceWorker.ready`: senza un worker registrato quella promise non si
    // risolve e il logout resterebbe appeso. `getRegistration` e' immediata.
    const registration = await navigator.serviceWorker.getRegistration()
    return registration?.pushManager ?? null
  } catch {
    return null
  }
}

export async function unsubscribePushOnLogout(
  env: PushLogoutEnvironment = {},
): Promise<PushUnsubscribeOutcome> {
  try {
    const pushManager = await (env.getPushManager ?? browserPushManager)()
    if (!pushManager) return 'unsupported'

    const subscription = await pushManager.getSubscription()
    if (!subscription) return 'none'

    return (await subscription.unsubscribe()) ? 'unsubscribed' : 'failed'
  } catch {
    // Il logout non deve dipendere dal push: qualunque errore resta confinato qui.
    return 'failed'
  }
}
