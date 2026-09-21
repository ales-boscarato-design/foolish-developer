/**
 * Test del contratto "quello che il cliente vede e' quello che paga" dal lato
 * della PAGINA di checkout (destinazioni extra-UE).
 *
 * Perche' esiste: `landed-cost.test.ts` prova la catena del server. Qui si
 * prova quello che vede il browser, cioe' la stessa domanda che il cliente si
 * fa: se la risposta del server non e' ancora arrivata (o e' stata rifiutata:
 * 429, 503, carrello con pack), la pagina mostra un prezzo PRUDENZIALE che
 * deve restare sopra — o uguale a — quello che il checkout incassa.
 *
 * Misura che ha aperto il caso (21/09/2026, prima della correzione): la pagina
 * mostrava il solo profilo di paese mentre il checkout incassava
 * `max(profilo, tabella in casa)`. 18 combinazioni su 32 divergevano, SEMPRE
 * con la pagina sotto: CA merce 50,00 → mostrato 50,14 / incassato 95,73;
 * JP 50,00 → 48,00 / 111,65; US 99,00 → 48,00 / 84,14; NO 50,00 → 60,82 /
 * 81,22; GB 50,00 → 56,36 / 66,51; CH 20,00 → 48,00 / 52,49.
 *
 * Il test e' rosso sul codice precedente: e' stato validato rimettendo il
 * difetto (pagina = solo profilo) e osservando i numeri esatti qui sopra.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EXTRA_EU_MINIMUM_SHIPPING_CENTS,
  extraEuDisplayedPriceCents,
  prudentialExtraEuPriceCents,
  tableCostCents,
} from './landed-cost-price'
import { cartFingerprint, isPackSku, resolveExtraEuShipping, signQuoteToken } from './landed-cost'
import {
  ALLOWED_SHIPPING_COUNTRIES,
  EXTRA_EU_MINIMUM_SHIPPING,
  getShippingZone,
} from './shipping'

process.env.SHIPPING_QUOTE_TOKEN_SECRET = 'test-only-token-secret'

/** Tutte le destinazioni extra-UE vendibili. */
const EXTRA_EU_COUNTRIES = ALLOWED_SHIPPING_COUNTRIES.filter(
  (country) => getShippingZone(country) === 'EXTRA_EU',
)

/** Valori di merce: sotto il pavimento, sulle bande misurate, sopra l'ultima. */
const GOODS_CENTS = [1200, 2000, 2390, 5000, 9900, 19_900, 50_000]

const NO_QUOTE_CONFIG = { url: 'https://quote.test/landed-cost/v1/quote', secret: '', enabled: false }

/** Quello che il checkout incassa senza gettone: il percorso prudenziale. */
async function chargedWithoutToken(
  countryCode: string,
  goodsCents: number,
  items: { sku: string; quantity: number }[] = [{ sku: 'TS-A4', quantity: 1 }],
): Promise<number> {
  const resolution = await resolveExtraEuShipping({
    countryCode,
    goodsCents,
    items,
    quoteConfig: NO_QUOTE_CONFIG,
  })
  assert.ok(resolution, `nessuna risoluzione per ${countryCode} ${goodsCents}`)
  return resolution.costCents
}

test('ACCETTAZIONE: senza risposta del server la pagina non mostra MAI meno di quello che il checkout incassa', async () => {
  const sotto: string[] = []
  const diverse: string[] = []
  for (const country of EXTRA_EU_COUNTRIES) {
    for (const goodsCents of GOODS_CENTS) {
      const shown = extraEuDisplayedPriceCents({ countryCode: country, goodsCents, serverQuotedCents: null })
      assert.ok(shown !== null, `${country} ${goodsCents}`)
      assert.ok(Number.isSafeInteger(shown), `${country} ${goodsCents}`)
      const charged = await chargedWithoutToken(country, goodsCents)
      if (shown < charged) sotto.push(`${country} merce ${goodsCents / 100}: mostrato ${shown} < incassato ${charged}`)
      if (shown !== charged) diverse.push(`${country} merce ${goodsCents / 100}: mostrato ${shown} != incassato ${charged}`)
    }
  }
  assert.deepEqual(sotto, [], 'la pagina mostrerebbe meno di quanto il checkout incassa')
  // Non basta non stare sotto: e' la stessa funzione, quindi il numero e' lo stesso.
  assert.deepEqual(diverse, [])
})

test('casi misurati: i numeri della pagina e quelli del checkout combaciano al centesimo', async () => {
  // Tabella di regressione sui casi che divergevano prima della correzione.
  const casi: [string, number, number][] = [
    ['CA', 5000, 9573],
    ['CA', 9900, 9573],
    ['CA', 2000, 7283],
    ['JP', 5000, 11_165],
    ['JP', 9900, 11_165],
    ['US', 9900, 8414],
    ['NO', 5000, 8122],
    ['GB', 5000, 6651],
    ['CH', 2000, 5249],
    ['CH', 9900, 5249],
  ]
  for (const [country, goodsCents, incassato] of casi) {
    const shown = extraEuDisplayedPriceCents({ countryCode: country, goodsCents, serverQuotedCents: null })
    assert.equal(shown, incassato, `${country} merce ${goodsCents / 100}`)
    assert.equal(await chargedWithoutToken(country, goodsCents), incassato, `${country} merce ${goodsCents / 100}`)
  }
})

test('quando il server ha risposto la pagina mostra ESATTAMENTE quel prezzo', () => {
  // La quota live puo' essere piu' economica della base prudenziale: la pagina
  // mostra la quota, non un numero prudenziale piu' alto del dovuto.
  assert.equal(extraEuDisplayedPriceCents({ countryCode: 'CH', goodsCents: 9900, serverQuotedCents: 5249 }), 5249)
  assert.equal(extraEuDisplayedPriceCents({ countryCode: 'CA', goodsCents: 5000, serverQuotedCents: 6621 }), 6621)
  assert.equal(extraEuDisplayedPriceCents({ countryCode: 'US', goodsCents: 5000, serverQuotedCents: 6549 }), 6549)
  // Un valore non valido non e' un prezzo: si ricade sulla regola prudenziale.
  for (const invalid of [0, -1, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      extraEuDisplayedPriceCents({ countryCode: 'CH', goodsCents: 9900, serverQuotedCents: invalid }),
      prudentialExtraEuPriceCents('CH', 9900),
      String(invalid),
    )
  }
})

test('Italia e UE restano fuori dal prezzo extra-UE', () => {
  for (const country of ['IT', 'DE', 'FR', 'ES', 'NL']) {
    assert.equal(extraEuDisplayedPriceCents({ countryCode: country, goodsCents: 9900, serverQuotedCents: null }), null)
    assert.equal(extraEuDisplayedPriceCents({ countryCode: country, goodsCents: 9900, serverQuotedCents: 1499 }), null)
    assert.equal(prudentialExtraEuPriceCents(country, 9900), null)
  }
})

test('nessuna destinazione extra-UE mostra 0,00 o meno del pavimento', async () => {
  for (const country of EXTRA_EU_COUNTRIES) {
    for (const goodsCents of [0, ...GOODS_CENTS, 500_000]) {
      const shown = extraEuDisplayedPriceCents({ countryCode: country, goodsCents, serverQuotedCents: null })
      assert.ok(shown !== null && shown > 0, `${country} ${goodsCents}`)
      assert.ok(shown >= EXTRA_EU_MINIMUM_SHIPPING_CENTS, `${country} ${goodsCents}`)
      assert.equal(shown >= Math.ceil(EXTRA_EU_MINIMUM_SHIPPING * 100), true, `${country} ${goodsCents}`)
    }
  }
})

test('il gettone del prezzo MOSTRATO viene incassato al centesimo anche sul percorso prudenziale', async () => {
  // Il percorso che prima rompeva: la pagina non ha il prezzo del server, mostra
  // il prudenziale; il checkout non riceve il gettone e risolve da capo. I due
  // numeri devono coincidere, altrimenti l'avviso in pagina e' una bugia.
  const items = [{ sku: 'T-3D-WMN-BCK', quantity: 1 }]
  for (const country of EXTRA_EU_COUNTRIES) {
    const goodsCents = 9900
    const shown = extraEuDisplayedPriceCents({ countryCode: country, goodsCents, serverQuotedCents: null })
    assert.ok(shown !== null, country)
    const charged = await chargedWithoutToken(country, goodsCents, items)
    assert.equal(shown, charged, country)
    // E con il gettone di quel prezzo si incassa ancora lo stesso importo.
    const token = signQuoteToken({
      countryCode: country,
      fingerprint: cartFingerprint(items, country),
      costCents: shown,
    })
    assert.ok(token, country)
    const withToken = await resolveExtraEuShipping({
      countryCode: country,
      goodsCents,
      items,
      quoteToken: token,
      quoteConfig: NO_QUOTE_CONFIG,
    })
    assert.ok(withToken, country)
    assert.equal(withToken.costCents, shown, country)
  }
})

test('carrello con pack: la pagina mostra il prudenziale e il checkout incassa lo stesso', async () => {
  const items = [{ sku: 'T-3D-WMN-BCK-pack-2', quantity: 1 }]
  assert.equal(isPackSku(items[0]!.sku), true)
  const shown = extraEuDisplayedPriceCents({ countryCode: 'CA', goodsCents: 19_800, serverQuotedCents: null })
  assert.ok(shown !== null)
  assert.equal(shown, await chargedWithoutToken('CA', 19_800, items))
})

test('la tabella in casa resta il pavimento del prezzo prudenziale', () => {
  // Dove una banda misurata esiste ed e' piu' alta del profilo, il prezzo
  // prudenziale parte da quella banda: il profilo da solo sottostimerebbe.
  for (const country of ['CA', 'GB', 'JP', 'NO', 'US', 'CH']) {
    const goodsCents = 9900
    const banda = tableCostCents(country, goodsCents)
    assert.ok(banda !== null, country)
    const shown = extraEuDisplayedPriceCents({ countryCode: country, goodsCents, serverQuotedCents: null })
    assert.ok(shown !== null, country)
    assert.ok(shown >= banda, `${country}: ${shown} sotto la banda ${banda}`)
  }
})
