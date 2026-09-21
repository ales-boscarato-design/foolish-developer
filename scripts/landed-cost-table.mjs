#!/usr/bin/env node
/**
 * Rigenera la tabella dei prezzi reali extra-UE tenuta in casa dal negozio
 * (`storefront/src/lib/landed-cost-table.json`).
 *
 * Perche' esiste: il negozio non deve dipendere in tempo reale dalla Pi di
 * Alfred. Quando la Pi non risponde entro il tempo breve, il carrello usa
 * QUESTA tabella (`src/lib/landed-cost.ts`), poi il profilo di paese. La
 * tabella contiene solo quote REALI, una per paese e per banda di valore.
 *
 * Uso (il segreto non si stampa e non si scrive su file):
 *
 *   LANDED_COST_URL=https://alfred.thefoolishbutcher.com/landed-cost/v1/quote \
 *   LANDED_COST_SHARED_SECRET=<segreto letto sulla Pi> \
 *   node scripts/landed-cost-table.mjs --out storefront/src/lib/landed-cost-table.json
 *
 * Oppure con sonde esplicite (COUNTRY:ZIP:CITY:SKU:QTY):
 *
 *   ... node scripts/landed-cost-table.mjs --probe CH:4058:Basel:TS-A4:1
 *
 * Solo un PEZZO per carrello: al 21/09/2026 le quote multi-pezzo gonfiano dazi
 * e IVA di un fattore pari alla quantita' (CH 10 pezzi: 210,86 invece di circa
 * 21 su merce 239) e non sono un prezzo. Il controllo qui sotto scarta quelle
 * quote, come fa il negozio a runtime.
 *
 * Non crea acquisti: una quota puo' creare una fattura doganale di checkout su
 * Packlink (nessuna spedizione acquistata). Non e' spammabile: rispetta i
 * limiti del servizio (30 quote/10 min per sessione, 90/10 min per IP).
 */

import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const MAX_IMPLIED_IMPORT_RATE = 0.60
const MULTI_UNIT_IMPORT_RATE_TOLERANCE = 0.08

/** Aliquote di legge dazi+IVA per paese, le stesse del profilo prudenziale. */
export const REFERENCE_IMPORT_RATE = {
  CH: 0.081,
  GB: 0.20,
  NO: 0.25,
  CA: 0.15,
  AU: 0.10,
  JP: 0.10,
  US: 0.15,
  BR: 0.25,
}

export const DEFAULT_PROBES = [
  { country: 'CH', zip: '4058', city: 'Basel', sku: 'TS-A4', qty: 1 },
  { country: 'CH', zip: '4058', city: 'Basel', sku: 'T-3D-WMN-BCK', qty: 1 },
  { country: 'GB', zip: 'SW1A 1AA', city: 'London', sku: 'TS-A4', qty: 1 },
  { country: 'GB', zip: 'SW1A 1AA', city: 'London', sku: 'T-3D-WMN-BCK', qty: 1 },
  { country: 'NO', zip: '0150', city: 'Oslo', sku: 'TS-A4', qty: 1 },
  { country: 'NO', zip: '0150', city: 'Oslo', sku: 'T-3D-WMN-BCK', qty: 1 },
  { country: 'CA', zip: 'M5H 2N2', city: 'Toronto', sku: 'TS-A4', qty: 1 },
  { country: 'CA', zip: 'M5H 2N2', city: 'Toronto', sku: 'T-3D-WMN-BCK', qty: 1 },
  { country: 'AU', zip: '2000', city: 'Sydney', sku: 'TS-A4', qty: 1 },
  { country: 'AU', zip: '2000', city: 'Sydney', sku: 'T-3D-WMN-BCK', qty: 1 },
  { country: 'JP', zip: '100-0001', city: 'Tokyo', sku: 'TS-A4', qty: 1 },
  { country: 'JP', zip: '100-0001', city: 'Tokyo', sku: 'T-3D-WMN-BCK', qty: 1 },
  { country: 'US', zip: '10001', city: 'New York', sku: 'TS-A4', qty: 1 },
  { country: 'US', zip: '10001', city: 'New York', sku: 'T-3D-WMN-BCK', qty: 1 },
]

export function quoteImportChargesImplausible(row) {
  const base = Number(row.transport) + Number(row.goods_value)
  if (!Number.isFinite(base) || base <= 0) return true
  const impliedRate = Number(row.import_charges) / base
  if (!Number.isFinite(impliedRate)) return true
  if (impliedRate > MAX_IMPLIED_IMPORT_RATE) return true
  if (row.quantity > 1) {
    const reference = REFERENCE_IMPORT_RATE[String(row.country).toUpperCase()] ?? 0.25
    if (impliedRate > reference + MULTI_UNIT_IMPORT_RATE_TOLERANCE) return true
  }
  return false
}

function parseArgs(argv) {
  const probes = []
  let out = 'storefront/src/lib/landed-cost-table.json'
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      out = argv[index + 1]
      index += 1
    } else if (arg === '--probe') {
      const [country, zip, city, sku, qty] = String(argv[index + 1] ?? '').split(':')
      if (!country || !sku) throw new Error(`sonda non valida: ${argv[index + 1]}`)
      probes.push({ country, zip: zip ?? '', city: city ?? '', sku, qty: Number(qty ?? 1) })
      index += 1
    }
  }
  return { probes: probes.length > 0 ? probes : DEFAULT_PROBES, out }
}

async function main() {
  const url = (process.env.LANDED_COST_URL || 'https://alfred.thefoolishbutcher.com/landed-cost/v1/quote').trim()
  const secret = (process.env.LANDED_COST_SHARED_SECRET || '').trim()
  if (!secret) {
    console.error('manca LANDED_COST_SHARED_SECRET (il segreto si legge sulla Pi, non si incolla qui)')
    process.exit(2)
  }
  const { probes, out } = parseArgs(process.argv.slice(2))
  const countries = {}
  const skipped = []

  for (const probe of probes) {
    const cartId = `tfc-table-${probe.country.toLowerCase()}-${probe.sku.toLowerCase()}-${probe.qty}`
    let parsed = null
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TFC-Key': secret },
        body: JSON.stringify({
          cart_id: cartId,
          destination: { country: probe.country, zip: probe.zip, city: probe.city },
          items: [{ sku: probe.sku, quantity: probe.qty }],
        }),
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) {
        skipped.push(`${probe.country} ${probe.sku} x${probe.qty}: http_${response.status}`)
        continue
      }
      parsed = await response.json()
    } catch (error) {
      skipped.push(`${probe.country} ${probe.sku} x${probe.qty}: ${error.name}`)
      continue
    }
    const service = Array.isArray(parsed?.services) ? parsed.services[0] : null
    if (parsed?.status !== 'ok' || !service) {
      skipped.push(`${probe.country} ${probe.sku} x${probe.qty}: ${parsed?.code || 'no_quote'}`)
      continue
    }
    const row = {
      country: probe.country,
      quantity: probe.qty,
      goods_value: Number(parsed.goods_value),
      transport: Number(service.transport),
      import_charges: Number(service.import_charges),
      shipping_and_import: Number(service.shipping_and_import),
      landed_cost_estimate: Number(service.landed_cost_estimate),
      service_id: service.service_id,
      carrier: service.carrier,
      service_name: service.service_name,
      checkout_invoice_number: service.checkout_invoice_number,
    }
    if (quoteImportChargesImplausible(row)) {
      skipped.push(`${probe.country} ${probe.sku} x${probe.qty}: oneri import non plausibili (aliquota implicita)`)
      continue
    }
    const shippingAndImportCents = Math.round(row.shipping_and_import * 100)
    const landedCostCents = Math.round(row.landed_cost_estimate * 100)
    const band = {
      goods_value_cents: Math.round(row.goods_value * 100),
      shipping_and_import_cents: shippingAndImportCents,
      landed_cost_cents: landedCostCents,
      cost_basis_cents: Math.max(shippingAndImportCents, landedCostCents),
      service_id: row.service_id,
      carrier: row.carrier,
      service_name: row.service_name,
      checkout_invoice_number: row.checkout_invoice_number,
      probe_sku: probe.sku,
      quoted_at: new Date().toISOString(),
    }
    const bands = (countries[probe.country] ??= [])
    const duplicate = bands.findIndex((entry) => entry.goods_value_cents === band.goods_value_cents)
    if (duplicate === -1) bands.push(band)
    else bands[duplicate] = band
    console.log(`${probe.country} ${probe.sku} x${probe.qty}: merce ${row.goods_value} -> base ${band.cost_basis_cents / 100}`)
  }

  for (const bands of Object.values(countries)) {
    bands.sort((a, b) => a.goods_value_cents - b.goods_value_cents)
  }

  const document = {
    _doc: [
      'Tabella dei prezzi REALI extra-UE tenuta in casa dal negozio.',
      'Sorgente: quota live sul servizio della Pi (POST /landed-cost/v1/quote), una per paese e per banda di valore.',
      'La usa il negozio quando la Pi non risponde entro il tempo breve: un guasto della Pi deve costare PRECISIONE, non vendite.',
      'Le bande sono solo quote con UN PEZZO nel carrello: le quote multi-pezzo gonfiano dazi e IVA di un fattore pari alla quantita e non sono un prezzo.',
      'Non si modifica a mano: si rigenera con scripts/landed-cost-table.mjs (che parla con la Pi) e si sottopone a review.',
    ],
    schema: 1,
    generated_at: new Date().toISOString(),
    generator: 'scripts/landed-cost-table.mjs (quota live servita dalla Pi di Alfred)',
    currency: 'EUR',
    countries: Object.fromEntries(
      Object.entries(countries).sort(([a], [b]) => a.localeCompare(b)).map(([code, bands]) => [code, { bands }]),
    ),
  }

  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`)
  console.log(`scritto ${out}: ${Object.keys(countries).length} paesi`)
  if (skipped.length > 0) console.log(`saltate:\n  ${skipped.join('\n  ')}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
