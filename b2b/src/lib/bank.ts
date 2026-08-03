// Coordinate bonifico rivenditori — unica fonte per pagina di conferma ed email.
//
// Il valore vive nelle variabili Railway del servizio foolish-b2b, non nel
// codice: il repo è pubblico, e cambiare banca non deve costare un commit.
// Se B2B_IBAN manca, chi legge NON deve vedere un IBAN vecchio: entrambi i
// consumatori trattano `null` mostrando un recapito a cui chiedere i dati.

const DEFAULT_INTESTATARIO = 'The Foolish Butcher Srl'

/** Raggruppa in blocchi di 4 come si scrive un IBAN: si trascrive a mano. */
export function formatIban(raw: string): string {
  const compact = raw.replace(/\s+/g, '').toUpperCase()
  return compact.replace(/(.{4})/g, '$1 ').trim()
}

export function getBankDetails(): { iban: string; intestatario: string } | null {
  const raw = process.env.B2B_IBAN?.trim()
  if (!raw) return null
  return {
    iban: formatIban(raw),
    intestatario: process.env.B2B_INTESTATARIO?.trim() || DEFAULT_INTESTATARIO,
  }
}
