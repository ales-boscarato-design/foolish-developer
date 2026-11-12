import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createTranslator } from 'next-intl'

import {
  FREE_SHIPPING_BADGE_LOCALES,
  badgeZoneForLocale,
  flatShippingCostEuros,
  formatBadgeAmount,
  freeShippingBadgeCopy,
  freeShippingThresholdEuros,
  homeFreeShippingBadge,
  normalizeBadgeLocale,
} from './free-shipping-badge'
import {
  FLAT_ZONE_CONFIG,
  calculateShipping,
  freeShippingRemaining,
  getShippingZone,
  type ShippingZone,
} from './shipping'

/**
 * Il badge «spedizione gratuita» prometteva «€60» in tutte e cinque le lingue
 * mentre il codice applicava 50 all'Italia e 150 all'Unione Europea: un numero
 * scritto a mano nei messaggi che nessun test poteva far divergere dal codice.
 *
 * Questi test tengono insieme le due meta' della promessa: il NUMERO viene da
 * `shipping.ts` (letto, non ricopiato) e il TESTO dai `messages/*.json`,
 * renderizzato con il traduttore vero di next-intl — non con una sostituzione
 * fatta a mano nel test, che potrebbe divergere da come parla il sito.
 */

type Messages = Record<string, unknown>

function readMessages(locale: string): Messages {
  const file = path.join(process.cwd(), 'messages', `${locale}.json`)
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Messages
}

function namespace(messages: Messages, dotted: string): Record<string, unknown> {
  let node: unknown = messages
  for (const part of dotted.split('.')) {
    assert.ok(node && typeof node === 'object', `namespace ${dotted} assente`)
    node = (node as Record<string, unknown>)[part]
  }
  assert.ok(node && typeof node === 'object', `namespace ${dotted} non e' un oggetto`)
  return node as Record<string, unknown>
}

/**
 * Il traduttore vero di next-intl, tipizzato alla larga: i messaggi qui si
 * leggono da disco a runtime, quindi il tipo delle chiavi non puo' essere
 * quello statico. La resa resta quella di produzione (ICU), non una
 * sostituzione artigianale che potrebbe divergere dal sito.
 */
type Translate = (key: string, values?: Record<string, string>) => string

function translator(locale: string, namespaced: string): Translate {
  // La firma generica di `createTranslator` pretende i messaggi tipizzati
  // staticamente; qui arrivano da disco, quindi la si chiama con la forma che
  // accetta davvero a runtime.
  const build = createTranslator as unknown as (options: {
    locale: string
    messages: unknown
    namespace: string
  }) => Translate
  return build({ locale, messages: readMessages(locale), namespace: namespaced })
}

/** Il badge come lo rende la pagina, con l'interpolazione di next-intl. */
function renderBadge(locale: string, zone: ShippingZone): { title: string; body: string; amount: string | null } {
  const copy = freeShippingBadgeCopy(locale, zone)
  const t = translator(locale, 'home.badges.freeShipping')
  return {
    title: copy.amount !== null ? t(copy.titleKey, { amount: copy.amount }) : t(copy.titleKey),
    body: t(copy.bodyKey),
    amount: copy.amount,
  }
}

test('la soglia gratuita viene da shipping.ts: 60 in Italia, 150 in Unione Europea', () => {
  assert.equal(FLAT_ZONE_CONFIG.IT.freeAbove, 60, 'la soglia italiana promessa al cliente')
  assert.equal(FLAT_ZONE_CONFIG.EU.freeAbove, 150)
  assert.equal(freeShippingThresholdEuros('IT'), 60)
  assert.equal(freeShippingThresholdEuros('EU'), 150)
  // La tariffa piatta vive nello stesso posto: i termini non la ricopiano.
  assert.equal(flatShippingCostEuros('IT'), FLAT_ZONE_CONFIG.IT.cost)
  assert.equal(flatShippingCostEuros('EU'), FLAT_ZONE_CONFIG.EU.cost)
})

test('confine Italia: 59,99 paga la tariffa, 60,00 e\' gratuita', () => {
  const below = calculateShipping(59.99, 'IT')
  assert.equal(below.isFree, false)
  assert.equal(below.cost, 7.65)
  assert.equal(below.freeAbove, 60)

  const atThreshold = calculateShipping(60, 'IT')
  assert.equal(atThreshold.isFree, true)
  assert.equal(atThreshold.cost, 0)

  // Quanto manca: un centesimo sotto la soglia deve essere positivo.
  const remaining = freeShippingRemaining(59.99, 'IT')
  assert.ok(Math.abs(remaining - 0.01) < 1e-9, `atteso ~0,01, letto ${remaining}`)
  assert.equal(freeShippingRemaining(60, 'IT'), 0)
})

test('confine Unione Europea: 149,99 paga, 150,00 e\' gratuita', () => {
  assert.equal(calculateShipping(149.99, 'DE').isFree, false)
  assert.equal(calculateShipping(149.99, 'DE').cost, 14.99)
  assert.equal(calculateShipping(150, 'DE').isFree, true)
  assert.equal(calculateShipping(150, 'DE').cost, 0)
  assert.ok(Math.abs(freeShippingRemaining(149.99, 'DE') - 0.01) < 1e-9, 'un centesimo sotto la soglia europea')
})

test('ogni lingua promette la soglia del suo paese: 60 / 150 / 150 / 150 / 150', () => {
  const expected: Record<string, string> = { it: '60', en: '150', fr: '150', es: '150', de: '150' }

  for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
    assert.equal(normalizeBadgeLocale(locale), locale)
    const badge = renderBadge(locale, badgeZoneForLocale(locale))
    assert.equal(badge.amount, expected[locale], `${locale}: importo nel segnaposto`)
    assert.ok(
      badge.title.includes(expected[locale]),
      `${locale}: il titolo «${badge.title}» non contiene ${expected[locale]}`,
    )
    // Nessuna lingua non italiana deve portarsi dietro la soglia italiana.
    if (locale !== 'it') {
      assert.ok(
        !badge.title.includes('60'),
        `${locale}: il titolo «${badge.title}» nomina ancora la soglia italiana`,
      )
      assert.equal(badgeZoneForLocale(locale), 'EU', `${locale} promette la zona europea`)
    }
    assert.ok(badge.body.length > 0, `${locale}: corpo del badge vuoto`)
  }

  assert.deepEqual(
    FREE_SHIPPING_BADGE_LOCALES.map((l) => badgeZoneForLocale(l)),
    ['IT', 'EU', 'EU', 'EU', 'EU'],
  )
})

test('con destinazione extra-UE il badge non promette niente e nomina dazi e IVA', () => {
  const FREE_WORDS = /gratis|gratuit|kostenlos|kostenfrei|\bfree\b/i
  const DUTIES = /dazi|duties|aranceles|z[öo]lle|droits de douane/i
  const IMPORT_TAX = /\biva\b|\btva\b|\bvat\b|einfuhrumsatzsteuer|importazione|importaci[oó]n|importation|einfuhr/i

  for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
    const badge = renderBadge(locale, 'EXTRA_EU')
    const text = `${badge.title} ${badge.body}`

    assert.equal(badge.amount, null, `${locale}: su extra-UE non esiste una soglia`)
    assert.ok(!FREE_WORDS.test(text), `${locale}: promette ancora spedizione gratuita — «${text}»`)
    assert.ok(!/\d/.test(text), `${locale}: un numero in un testo che non deve promettere importi — «${text}»`)
    assert.ok(DUTIES.test(text), `${locale}: non nomina i dazi — «${text}»`)
    assert.ok(IMPORT_TAX.test(text), `${locale}: non nomina l'IVA all'importazione — «${text}»`)
  }
})

test('il testo extra-UE non e\' la stessa frase tradotta: la promessa cambia con la zona', () => {
  for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
    const eu = renderBadge(locale, 'EU')
    const extra = renderBadge(locale, 'EXTRA_EU')
    assert.notEqual(eu.title, extra.title, `${locale}: titolo identico nelle due zone`)
    assert.notEqual(eu.body, extra.body, `${locale}: corpo identico nelle due zone`)
  }
})

test('la quota di spedizione gratuita la decide l\'indirizzo, non la lingua', () => {
  // Un visitatore italiano che spedisce in Francia: la home promette la soglia
  // italiana, il calcolo per l'indirizzo francese libera solo a 150, e il
  // checkout mostra quello che il calcolo applica.
  assert.equal(homeFreeShippingBadge('it').amount, '60')
  assert.equal(getShippingZone('FR'), 'EU')
  assert.equal(freeShippingRemaining(60, 'FR'), 90, 'il checkout mostra la soglia dell\'indirizzo')
  assert.equal(freeShippingRemaining(60, 'IT'), 0)

  // La copia che il checkout usa per una destinazione europea non e' quella
  // italiana: nessun percorso mostra 60 a chi paga con soglia 150.
  assert.equal(freeShippingBadgeCopy('it', 'EU').amount, '150')
  assert.equal(calculateShipping(60, 'FR').isFree, false)
})

test('su extra-UE nessuna soglia e nessuna promo azzera la tariffe doganale', () => {
  // La regola vive in shipping.ts ed e' la stessa che il checkout e il webhook
  // usano: il badge non deve introdurre un percorso che la contraddica.
  const ch = calculateShipping(10000, 'CH')
  assert.equal(ch.zone, 'EXTRA_EU')
  assert.equal(ch.freeAbove, null)
  assert.equal(ch.isFree, false)
  assert.equal(ch.freeShippingPromoAllowed, false)
  assert.equal(freeShippingRemaining(10000, 'CH'), 0)
  assert.equal(freeShippingBadgeCopy('it', 'EXTRA_EU').amount, null)
})

test('nessun importo di soglia scritto a mano nei messages: solo segnaposto', () => {
  // La guardia che impedisce al difetto di tornare: i numeri della promessa
  // vivono in shipping.ts, nei messaggi resta il segnaposto.
  const badgeKeys = ['title', 'body', 'titleExtraEu', 'bodyExtraEu'] as const
  const rateKeys = ['italy', 'europe'] as const

  for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
    const messages = readMessages(locale)

    const badge = namespace(messages, 'home.badges.freeShipping')
    assert.deepEqual(Object.keys(badge).sort(), [...badgeKeys].sort(), `${locale}: chiavi del badge`)
    for (const key of badgeKeys) {
      const value = badge[key]
      assert.equal(typeof value, 'string', `${locale}: ${key} non e' una stringa`)
      assert.ok(!/\d/.test(value as string), `${locale}: ${key} contiene un numero scritto a mano — «${value}»`)
    }
    assert.ok((badge.title as string).includes('{amount}'), `${locale}: il titolo non ha il segnaposto {amount}`)

    const rates = namespace(messages, 'termini.shippingRates')
    for (const key of rateKeys) {
      const value = rates[key] as string
      assert.ok(!/\d/.test(value), `${locale}: termini.shippingRates.${key} contiene un numero scritto a mano — «${value}»`)
      assert.ok(value.includes('{cost}'), `${locale}: termini.shippingRates.${key} non ha {cost}`)
      assert.ok(value.includes('{amount}'), `${locale}: termini.shippingRates.${key} non ha {amount}`)
    }
  }
})

test('nessun messaggio nomina piu\' le soglie vecchie accanto al simbolo euro', () => {
  // Guardia larga: la promessa sbagliata puo' ricomparire anche fuori dal badge
  // (una card, un banner, i termini). Le soglie sono due e si cercano tutte e due.
  const thresholds = [freeShippingThresholdEuros('IT'), freeShippingThresholdEuros('EU')]

  function strings(node: unknown, trail: string, out: Array<{ where: string; value: string }>): void {
    if (typeof node === 'string') {
      out.push({ where: trail, value: node })
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        strings(child, trail ? `${trail}.${key}` : key, out)
      }
    }
  }

  for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
    const all: Array<{ where: string; value: string }> = []
    strings(readMessages(locale), '', all)
    for (const { where, value } of all) {
      for (const amount of thresholds) {
        const written = new RegExp(`(€\\s*${amount}\\b|\\b${amount}\\s*€)`)
        assert.ok(
          !written.test(value),
          `${locale}: ${where} scrive a mano la soglia ${amount}€ — «${value}»`,
        )
      }
    }
  }
})

test('parita\' esatta delle chiavi e dei segnaposto fra le cinque lingue', () => {
  const reference = readMessages('it')
  const keysOf = (messages: Messages, dotted: string) => Object.keys(namespace(messages, dotted)).sort()
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

  for (const dotted of ['home.badges.freeShipping', 'termini.shippingRates']) {
    const referenceKeys = keysOf(reference, dotted)
    assert.ok(referenceKeys.length > 0, `${dotted}: namespace vuoto`)

    for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
      const messages = readMessages(locale)
      assert.deepEqual(keysOf(messages, dotted), referenceKeys, `${locale}: chiavi di ${dotted}`)

      const refNs = namespace(reference, dotted)
      const ns = namespace(messages, dotted)
      for (const key of referenceKeys) {
        assert.deepEqual(
          placeholders(ns[key] as string),
          placeholders(refNs[key] as string),
          `${locale}: segnaposto di ${dotted}.${key}`,
        )
      }
    }
  }
})

test('gli importi si formattano nella lingua della pagina', () => {
  assert.equal(formatBadgeAmount('it', 7.65, 2), '7,65')
  assert.equal(formatBadgeAmount('en', 7.65, 2), '7.65')
  assert.equal(formatBadgeAmount('fr', 14.99, 2), '14,99')
  assert.equal(formatBadgeAmount('de', 14.99, 2), '14,99')
  assert.equal(formatBadgeAmount('es', 7.65, 2), '7,65')
  // La soglia e' tonda in tutte le lingue: nessun decimale da leggere.
  assert.equal(formatBadgeAmount('it', 60), '60')
  assert.equal(formatBadgeAmount('en', 150), '150')
  // Locale non prevista o con regione: si ricade sulla lingua, mai su undefined.
  assert.equal(normalizeBadgeLocale('it-IT'), 'it')
  assert.equal(normalizeBadgeLocale('PT'), 'it')
  assert.equal(formatBadgeAmount('xx', 60), '60')
})
