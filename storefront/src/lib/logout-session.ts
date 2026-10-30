/**
 * Orchestrazione del logout. La sessione e' letta dal server, non da dati inviati
 * dal client, e l'email usata per azzerare la sottoscrizione push e' quella letta
 * dal server. Il cookie viene cancellato subito dopo la lettura della sessione,
 * prima dell'azzeramento push: cosi' un DB lento non tiene in vita la sessione.
 * Se la lettura della sessione o l'azzeramento push falliscono, il cookie si
 * cancella comunque e l'errore viene riportato a onError.
 */

export interface LogoutDeps {
  getSession(): Promise<{ email: string } | null>
  clearPushSubscription(email: string): Promise<unknown>
  deleteSessionCookie(): Promise<void> | void
  onError?: (err: unknown) => void
}

export interface LogoutResult {
  ok: true
  pushClearedFor: string | null
  pushClearFailed: boolean
}

export async function performLogout(deps: LogoutDeps): Promise<LogoutResult> {
  let session: { email: string } | null = null

  try {
    session = await deps.getSession()
  } catch (err) {
    // Sessione illeggibile: si prosegue comunque con la cancellazione del cookie.
    deps.onError?.(err)
  }

  let pushClearedFor: string | null = null
  let pushClearFailed = false

  // Il cookie muore prima dell'I/O del DB: un DB lento non tiene in vita la sessione.
  await deps.deleteSessionCookie()

  if (session) {
    try {
      await deps.clearPushSubscription(session.email)
      pushClearedFor = session.email
    } catch (err) {
      pushClearFailed = true
      // Nessuna email nel log: onError riceve solo l'errore.
      deps.onError?.(err)
    }
  }

  return { ok: true, pushClearedFor, pushClearFailed }
}
