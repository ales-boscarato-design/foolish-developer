import type { Access, CollectionConfig } from 'payload'

/**
 * Sblocco del lockout: ognuno puo' azzerare SOLO il proprio.
 *
 * PERCHE' NON BASTA IL DEFAULT DI PAYLOAD. Da 3.90.0 `access.unlock` usa
 * `defaultUnlockAccess`, che concede l'operazione a chi appartiene alla
 * collection admin (`user.collection === payload.config.admin.user`). Nel nostro
 * CMS `users` e' l'unica collection di autenticazione ed e' anche quella admin:
 * quindi il default, tradotto nel nostro modello, resta "qualunque utente CMS
 * autenticato puo' sbloccare qualunque account" (GHSA-jg8r-5jh2-v2xj,
 * CVE-2026-11779). Senza ruoli separati non esiste un insieme "admin" piu'
 * ristretto da cui far dipendere la decisione.
 *
 * L'unica regola verificabile con questo schema e' quindi "sblocchi te stesso":
 * restituiamo un vincolo sulla riga, non un booleano `true`, cosi' Payload limita
 * la query all'id dell'utente della richiesta. Sbloccare un altro account resta
 * un'operazione da database, fatta dal proprietario: nessuna API, nessun pannello
 * e nessun utente CMS puo' farla al posto suo.
 */
export const usersUnlockAccess: Access = ({ req }) =>
  req.user
    ? {
        id: { equals: req.user.id },
      }
    : false

export const Users: CollectionConfig = {
  slug: 'users',
  auth: {
    maxLoginAttempts: 5,
    lockTime: 30 * 60 * 1000, // 30 minuti
    useAPIKey: true, // permette di generare una API key per utente in alternativa alla password (28/07/2026)
  },
  access: {
    unlock: usersUnlockAccess,
  },
  admin: {
    useAsTitle: 'email',
    group: 'Sistema',
  },
  fields: [],
}
