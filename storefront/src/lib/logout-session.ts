/**
 * Orchestrazione del logout. L'azzeramento della sottoscrizione push avviene
 * dentro la stessa mutazione autenticata che cancella il cookie: la sessione e'
 * letta dal server, non da dati inviati dal client. Se l'azzeramento fallisce il
 * cookie si cancella comunque, per non far regredire il logout.
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
  const session = await deps.getSession()

  let pushClearedFor: string | null = null
  let pushClearFailed = false

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

  await deps.deleteSessionCookie()

  return { ok: true, pushClearedFor, pushClearFailed }
}
