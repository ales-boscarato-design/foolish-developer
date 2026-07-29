/**
 * VIES — validazione partita IVA contro il registro ufficiale UE.
 *
 * Perché esiste
 * -------------
 * Il portale rivenditori chiedeva l'account PRIMA del carrello e non
 * verificava mai la partita IVA che raccoglieva al checkout. Era chiuso
 * a chi voleva comprare e aperto a chiunque digitasse IT12345678901:
 * il muro non filtrava niente, bloccava soltanto.
 *
 * VIES risolve il filtro nel punto giusto — al pagamento, non
 * all'ingresso — e restituisce ragione sociale e indirizzo ufficiali,
 * che si possono confrontare con quanto dichiarato.
 *
 * Sul fallimento del servizio
 * ---------------------------
 * VIES è un servizio pubblico e cade spesso: i singoli Stati membri
 * vanno offline a rotazione. Se non risponde NON si blocca l'ordine.
 * Bloccare un cliente che sta pagando perché un'API governativa è giù
 * costa molto più che accettare una partita IVA non verificata e
 * controllarla a mano dopo. L'ordine parte marcato `unverified` e
 * finisce nella revisione manuale.
 *
 * È l'asimmetria opposta a quella della pipeline email, dove una lingua
 * non determinata blocca l'invio: lì l'errore arriva al cliente e non è
 * recuperabile, qui l'errore è recuperabile e il blocco costa una
 * vendita. La regola non è "fallire chiuso" — è guardare cosa costa di
 * più quando si sbaglia.
 */

export type ViesStatus = 'valid' | 'invalid' | 'unverified'

export interface ViesResult {
  status: ViesStatus
  /** Ragione sociale dal registro, quando il servizio la espone. */
  name?: string
  /** Indirizzo dal registro. */
  address?: string
  countryCode?: string
  vatNumber?: string
  /** Motivo tecnico, per i log — non da mostrare al cliente. */
  detail?: string
}

const VIES_ENDPOINT =
  'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'

/** Stati membri UE + Irlanda del Nord (XI). La Svizzera NON è nel VIES. */
export const VIES_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR',
  'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SE', 'SI', 'SK', 'XI',
])

/**
 * Divide "IT00470550013" in prefisso paese + numero.
 * Accetta spazi, punti e trattini, che i clienti inseriscono sempre.
 */
export function parseVatNumber(raw: string): { countryCode: string; vatNumber: string } | null {
  const cleaned = (raw || '').toUpperCase().replace(/[\s.\-/]/g, '')
  if (cleaned.length < 4) return null
  let countryCode = cleaned.slice(0, 2)
  const rest = cleaned.slice(2)
  // La Grecia si scrive GR ovunque tranne che nel VIES, dove è EL.
  if (countryCode === 'GR') countryCode = 'EL'
  if (!/^[A-Z]{2}$/.test(countryCode) || !rest) return null
  return { countryCode, vatNumber: rest }
}

export async function checkVatNumber(raw: string, timeoutMs = 8000): Promise<ViesResult> {
  const parsed = parseVatNumber(raw)
  if (!parsed) {
    return { status: 'invalid', detail: 'formato non riconosciuto' }
  }
  if (!VIES_COUNTRIES.has(parsed.countryCode)) {
    // Fuori dal perimetro VIES (es. CH, UK non-XI): non possiamo
    // verificarla, ma non è una partita IVA finta.
    return { status: 'unverified', ...parsed, detail: 'paese fuori dal VIES' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(VIES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      return { status: 'unverified', ...parsed, detail: `VIES HTTP ${res.status}` }
    }
    const data = await res.json()
    // userError arriva valorizzato quando lo Stato membro è offline
    // (MS_UNAVAILABLE, TIMEOUT, SERVICE_UNAVAILABLE...): non è un
    // giudizio sulla partita IVA.
    if (data?.userError && data.userError !== 'VALID' && data.userError !== 'INVALID') {
      return { status: 'unverified', ...parsed, detail: `VIES ${data.userError}` }
    }
    if (data?.valid === true) {
      return {
        status: 'valid',
        ...parsed,
        name: typeof data.name === 'string' && data.name !== '---' ? data.name.trim() : undefined,
        address:
          typeof data.address === 'string' && data.address !== '---'
            ? data.address.replace(/\n+/g, ', ').trim()
            : undefined,
      }
    }
    if (data?.valid === false) {
      return { status: 'invalid', ...parsed, detail: 'non presente nel registro' }
    }
    return { status: 'unverified', ...parsed, detail: 'risposta VIES non interpretabile' }
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error'
    return { status: 'unverified', ...parsed, detail: `VIES irraggiungibile (${name})` }
  } finally {
    clearTimeout(timer)
  }
}
