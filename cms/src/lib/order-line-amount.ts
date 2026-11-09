/**
 * Importo di riga usato nell'email di conferma e nella notifica admin.
 *
 * Perche' vince `lineTotalCents`: il checkout B2B calcola il totale in centesimi
 * (un solo `Math.round` sul prezzo scontato) e lo persiste nella riga JSON.
 * Ricalcolare `unitPrice * quantity` in floating point puo' divergere di un
 * centesimo (es. 0.9999 * 50 -> "49.99" invece del contabile "50.00"): la riga
 * mostrata deve quindi usare il valore contabile quando c'e'.
 *
 * Perche' resta il fallback: gli ordini retail storici non hanno il campo
 * `lineTotalCents` nel JSON; per quelli l'importo viene ricostruito con
 * `unitPrice * quantity`, arrotondato ai centesimi. Se invece il campo esiste
 * ma non e' un intero finito >= 0, il dato e' incoerente e non viene ne'
 * coercito ne' sostituito con l'aritmetica float: si restituisce `null`
 * (fail-closed), cosi' nessun importo inventato finisce in una email.
 *
 * Il parametro e' `Record<string, unknown>` di proposito: `Orders.ts` legge
 * `doc.lineItems` come `any`, e un tipo stretto qui obbligherebbe un cast nel
 * chiamante non compilabile senza la toolchain del CMS. Il file non importa
 * `payload`, `next` o altri moduli: e' TypeScript puro e gira con `tsx`.
 */

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function orderLineTotalCents(line: Record<string, unknown>): number | null {
  const ledgerCents = line.lineTotalCents

  // Campo presente: vale solo se e' un valore contabile valido. Un campo
  // presente ma corrotto non viene coercito ne' ignorato silenziosamente.
  if (ledgerCents !== undefined) {
    return isNonNegativeInteger(ledgerCents) ? ledgerCents : null
  }

  // Ordini retail storici, senza campo contabile: fallback deterministico.
  const unitPrice = line.unitPrice
  const quantity = line.quantity
  if (
    typeof unitPrice === 'number'
    && Number.isFinite(unitPrice)
    && typeof quantity === 'number'
    && Number.isFinite(quantity)
    && quantity > 0
  ) {
    return Math.round(unitPrice * quantity * 100)
  }

  return null
}

export function formatOrderLineTotal(line: Record<string, unknown>): string {
  const cents = orderLineTotalCents(line)
  return cents === null ? '—' : (cents / 100).toFixed(2)
}
