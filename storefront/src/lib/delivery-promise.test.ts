import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  buildDeliveryPromiseSnapshot,
  formatDeliveryPromiseDate,
  noPromiseSnapshot,
  notCapturedSnapshot,
  parseDeliveryPromise,
  parseDeliveryPromiseMetadataValue,
  serializeDeliveryPromise,
} from './delivery-promise'
import { estimateCartDelivery, type CartDeliveryEstimate } from './delivery-estimate'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const STOREFRONT_ROOT = join(REPO_ROOT, 'storefront')

type Fixture = {
  valid: Array<{ name: string; snapshot: Record<string, unknown> }>
  invalid: Array<{ name: string; snapshot: Record<string, unknown> }>
}

const fixture = JSON.parse(
  readFileSync(join(HERE, '__fixtures__', 'delivery-promise.json'), 'utf8'),
) as Fixture

/** Stima reale (nessun mock): il calendario e i margini sono quelli del codice. */
function estimate(overrides: Partial<Parameters<typeof estimateCartDelivery>[0]> = {}): CartDeliveryEstimate {
  return estimateCartDelivery({
    now: new Date('2026-11-20T09:00:00.000Z'), // venerdi', prima del cutoff
    country: 'IT',
    items: [{ madeToOrder: true, productionDays: 3 }],
    ...overrides,
  })
}

test('il contratto condiviso e la fixture sono d\'accordo', () => {
  for (const { name, snapshot } of fixture.valid) {
    assert.notEqual(parseDeliveryPromise(snapshot), null, `doveva essere valido: ${name}`)
  }
  for (const { name, snapshot } of fixture.invalid) {
    assert.equal(parseDeliveryPromise(snapshot), null, `doveva essere rifiutato: ${name}`)
  }
})

test('lo snapshot di una stima reale conserva partenza, data, zona e produzione', () => {
  const computed = estimate()
  const snapshot = buildDeliveryPromiseSnapshot({ estimate: computed, now: new Date('2026-11-20T09:00:00.000Z') })

  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.promiseShown, true)
  assert.equal(snapshot.reason, 'ok')
  assert.equal(snapshot.zone, 'IT_EU')
  assert.equal(snapshot.departureDate, computed.departureDate)
  assert.equal(snapshot.estimatedDeliveryDate, computed.date)
  assert.equal(snapshot.productionDays, 3)
  assert.equal(snapshot.marginDays, computed.marginDays)
  assert.equal(snapshot.fallback, false)
  assert.equal(snapshot.calculatedAt, '2026-11-20T09:00:00.000Z')

  // Cio' che si scrive e' cio' che si rilegge: la serializzazione per i
  // metadata Stripe non deve perdere ne' cambiare nulla.
  const roundTrip = parseDeliveryPromiseMetadataValue(serializeDeliveryPromise(snapshot))
  assert.deepEqual(roundTrip, snapshot)
})

test('carrello misto: la promessa usa l\'articolo piu\' lento e lo dichiara', () => {
  const computed = estimate({
    items: [
      { madeToOrder: false },
      { madeToOrder: true, productionDays: 4 },
      { madeToOrder: true, productionDays: 12 },
    ],
  })
  const snapshot = buildDeliveryPromiseSnapshot({ estimate: computed })
  assert.equal(snapshot.productionDays, 12)
  assert.equal(snapshot.fallback, false)
  assert.equal(snapshot.promiseShown, true)
})

test('una stima che non produce una data diventa uno snapshot senza date, con il motivo', () => {
  // 3.651 giorni: oltre il limite dichiarato della stima.
  const outOfBounds = estimate({ items: [{ madeToOrder: true, productionDays: 3_651 }] })
  const snapshot = buildDeliveryPromiseSnapshot({ estimate: outOfBounds })

  assert.equal(snapshot.promiseShown, false)
  assert.equal(snapshot.reason, 'estimate_unavailable')
  assert.equal(snapshot.zone, 'IT_EU')
  assert.equal(snapshot.departureDate, null)
  assert.equal(snapshot.estimatedDeliveryDate, null)
  assert.notEqual(parseDeliveryPromise(snapshot), null)
})

test('senza una data mostrata al cliente non si inventa una data', () => {
  const noPromise = noPromiseSnapshot(new Date('2026-11-20T09:00:00.000Z'))
  assert.equal(noPromise.promiseShown, false)
  assert.equal(noPromise.reason, 'not_shown')
  assert.equal(noPromise.estimatedDeliveryDate, null)
  assert.notEqual(parseDeliveryPromise(noPromise), null)

  const notCaptured = notCapturedSnapshot(new Date('2026-11-20T09:00:00.000Z'))
  assert.equal(notCaptured.reason, 'not_captured')
  assert.equal(notCaptured.promiseShown, false)
  assert.notEqual(parseDeliveryPromise(notCaptured), null)
})

test('la data congelata non cambia quando il calcolo di oggi darebbe un\'altra data', () => {
  // Promessa fatta venerdi' 20/11 per un articolo con 3 giorni di produzione.
  const frozen = buildDeliveryPromiseSnapshot({
    estimate: estimate(),
    now: new Date('2026-11-20T09:00:00.000Z'),
  })
  const stored = serializeDeliveryPromise(frozen)

  // Dopo il pagamento cambia tutto: festivita' dell'anno dopo, produzione
  // triplicata, destinazione extra-UE. Il dato conservato non si muove.
  const today = estimateCartDelivery({
    now: new Date('2027-12-24T18:00:00.000Z'),
    country: 'US',
    items: [{ madeToOrder: true, productionDays: 30 }],
  })
  assert.notEqual(today.date, frozen.estimatedDeliveryDate)
  assert.notEqual(today.departureDate, frozen.departureDate)

  const reread = parseDeliveryPromiseMetadataValue(stored)
  assert.deepEqual(reread, frozen)
  assert.equal(reread?.estimatedDeliveryDate, frozen.estimatedDeliveryDate)
})

test('un metadata assente o corrotto non produce uno snapshot', () => {
  assert.equal(parseDeliveryPromiseMetadataValue(undefined), null)
  assert.equal(parseDeliveryPromiseMetadataValue(null), null)
  assert.equal(parseDeliveryPromiseMetadataValue(''), null)
  assert.equal(parseDeliveryPromiseMetadataValue('{non json'), null)
  assert.equal(parseDeliveryPromiseMetadataValue('"stringa"'), null)
  assert.equal(parseDeliveryPromiseMetadataValue(JSON.stringify({ version: 1 })), null)
})

test('la data promessa si formatta nella lingua della pagina senza cambiare giorno', () => {
  assert.equal(formatDeliveryPromiseDate('it', '2026-12-25'), 'venerdì 25 dicembre')
  assert.equal(formatDeliveryPromiseDate('en', '2026-12-25'), 'Friday, December 25')
  assert.match(formatDeliveryPromiseDate('de', '2026-12-25'), /25\. Dezember/)
})

/**
 * La garanzia della card: NESSUNA schermata post-pagamento ricalcola la data.
 * Un import del calcolo in uno di questi file sarebbe la regressione, e non si
 * vedrebbe in nessun test di resa (la data tornerebbe "giusta" finche' il CMS
 * non cambia). Qui si legge il sorgente grezzo e si vietano i token.
 */
const POST_PAYMENT_SURFACES = [
  'storefront/src/app/[locale]/grazie/page.tsx',
  'storefront/src/app/ordine/[token]/page.tsx',
  'storefront/src/app/api/order/[token]/route.ts',
  'storefront/src/app/api/ordine/lookup/route.ts',
  'storefront/src/app/(customer-app)/account/(protected)/ordini/[id]/page.tsx',
  'storefront/src/app/api/stripe/session/route.ts',
  'cms/src/collections/Orders.ts',
]

const FORBIDDEN_IN_POST_PAYMENT = [
  'estimateCartDelivery',
  'addItalianWorkingDays',
  'delivery-estimate',
  'isItalianWorkingDay',
  'FIXED_ITALIAN_HOLIDAYS',
]

test('le superfici post-pagamento non contengono il calcolo della stima', () => {
  for (const rel of POST_PAYMENT_SURFACES) {
    const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
    for (const token of FORBIDDEN_IN_POST_PAYMENT) {
      assert.equal(
        source.includes(token),
        false,
        `${rel} contiene "${token}": la data promessa va letta dallo snapshot, non ricalcolata`,
      )
    }
  }
})

test('le superfici post-pagamento leggono davvero lo snapshot', () => {
  // Il contrario del test sopra: un file che non nomina ne' lo snapshot ne' il
  // validatore non puo' mostrare la promessa, e la riga sparirebbe in silenzio
  // (nessun errore, nessuna data: il cliente non sa piu' quando arriva).
  for (const rel of POST_PAYMENT_SURFACES) {
    const source = readFileSync(join(REPO_ROOT, rel), 'utf8')
    assert.equal(
      source.includes('deliveryPromise') || source.includes('parseDeliveryPromise'),
      true,
      `${rel} non legge lo snapshot della promessa`,
    )
  }
})

test('nessun altro file sotto storefront/src ricalcola la stima dopo il pagamento', () => {
  // Censimento: chi nomina il calcolo e' elencato qui, e ogni nuovo lettore va
  // aggiunto a mano (fail-closed: un file nuovo compare e fa rosso).
  const allowed = new Set([
    'src/lib/delivery-estimate.ts',
    'src/lib/delivery-estimate.test.ts',
    'src/lib/delivery-promise.ts',
    'src/lib/delivery-promise.test.ts',
    'src/app/api/stripe/delivery-estimate/route.ts',
    'src/app/api/stripe/delivery-estimate/route.test.ts',
    'src/app/api/stripe/checkout/route.ts',
    'src/app/api/stripe/checkout.delivery-estimate.test.ts',
    'src/lib/reorder.ts',
    // Percorsi PRE-pagamento: il carrello mostra la stima, il catalogo la
    // alimenta con `madeToOrder`/`productionDays`. Non sono superfici
    // post-pagamento e possono nominare il calcolo.
    'src/app/[locale]/checkout/page.tsx',
    'src/lib/catalog.ts',
    'src/lib/catalog.test.ts',
  ])
  const root = join(STOREFRONT_ROOT, 'src')
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        const rel = relative(STOREFRONT_ROOT, full).split('\\').join('/')
        if (allowed.has(rel)) continue
        const source = readFileSync(full, 'utf8')
        if (source.includes('estimateCartDelivery') || source.includes('delivery-estimate')) {
          offenders.push(rel)
        }
      }
    }
  }
  walk(root)
  assert.deepEqual(
    offenders,
    [],
    `questi file usano il calcolo della stima senza essere nella lista: ${offenders.join(', ')}`,
  )
})
