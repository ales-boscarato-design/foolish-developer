import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { createTranslator } from 'next-intl'

import {
  FREE_SHIPPING_BADGE_LOCALES,
  badgeZoneForLocale,
  checkoutImportDutiesBadgeVisible,
  flatShippingCostEuros,
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
import { MONEY_LOCALES, formatMoney, formatWholeMoney } from './money'

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

test('la promessa italiana nomina il paese: 60 vale in Italia, non fuori', () => {
  // Il difetto misurato il 12/11/2026: la home italiana diceva «Gratis sopra
  // 60€» senza dire dove. Un cliente italiano con indirizzo francese e carrello
  // da 100,00 leggeva la promessa italiana e al checkout trovava «aggiungi
  // 50,00 per la spedizione gratuita» con la spedizione a 14,99.
  const it = renderBadge('it', 'IT')
  assert.equal(it.amount, '60')
  assert.match(it.title, /italia/i, `la promessa italiana deve dire dove vale — «${it.title}»`)
  assert.match(it.body, /italia/i, `il corpo del badge deve dire dove vale — «${it.body}»`)

  // Nessuna delle altre lingue promette l'Italia: la loro zona e' l'Unione.
  for (const locale of ['en', 'fr', 'es', 'de']) {
    const title = renderBadge(locale, 'EU').title
    assert.ok(
      !/italia|italy|italie|italien/i.test(title),
      `${locale}: il badge europeo nomina l'Italia — «${title}»`,
    )
  }

  // Il caso del cliente: la promessa — ora qualificata — e' coerente col
  // checkout, che segue l'INDIRIZZO e non la lingua.
  assert.equal(freeShippingRemaining(100, 'FR'), 50)
  assert.equal(calculateShipping(100, 'FR').cost, 14.99)
  assert.equal(calculateShipping(100, 'FR').isFree, false)

  // Il caso opposto (inglese, indirizzo italiano): la soglia applicata e' 60,
  // quindi non compare nessun 150 a schermo — la riga «aggiungi» non esiste
  // perche' la spedizione e' gia' gratuita.
  assert.equal(calculateShipping(100, 'IT').isFree, true)
  assert.equal(freeShippingRemaining(100, 'IT'), 0)
  assert.equal(freeShippingBadgeCopy('en', 'IT').amount, '60')
})

test('con destinazione da quotare il badge «dazi e IVA inclusi» non si mostra', () => {
  // Il difetto misurato il 12/11/2026 su BR: la riga diceva «Spedizione — BR:
  // To be quoted» mentre il badge affermava che dazi e IVA erano «inclusi nel
  // prezzo di spedizione». Quel prezzo non esiste: la frase descriveva un
  // prezzo che nessuno ha quotato.
  const br = calculateShipping(12000, 'BR')
  assert.equal(br.zone, 'EXTRA_EU')
  assert.equal(br.requiresQuote, true, 'BR e\' una destinazione da quotare')
  assert.equal(
    checkoutImportDutiesBadgeVisible({ zone: br.zone, isFree: br.isFree, requiresQuote: br.requiresQuote }),
    false,
    'su una destinazione da quotare il badge non compare',
  )

  // Destinazione extra-UE con prezzo landed vero (CH): il badge resta, e dice
  // il vero — li' dazi e IVA sono davvero inclusi nel prezzo incassato.
  const ch = calculateShipping(10000, 'CH')
  assert.equal(ch.requiresQuote, false)
  assert.equal(
    checkoutImportDutiesBadgeVisible({ zone: ch.zone, isFree: ch.isFree, requiresQuote: ch.requiresQuote }),
    true,
  )

  // Fuori dall'extra-UE la promessa e' la soglia, non «dazi inclusi».
  for (const country of ['IT', 'DE']) {
    const rate = calculateShipping(10, country)
    assert.equal(
      checkoutImportDutiesBadgeVisible({ zone: rate.zone, isFree: rate.isFree, requiresQuote: rate.requiresQuote }),
      false,
      `${country}: il badge doganale non appartiene alle zone senza dogana`,
    )
  }

  // Una spedizione gratis non «include» oneri: nessun badge nemmeno li'.
  assert.equal(
    checkoutImportDutiesBadgeVisible({ zone: 'EXTRA_EU', isFree: true, requiresQuote: false }),
    false,
  )

  // Il testo «inclusi» esiste ancora (e' vero su CH): a nasconderlo su BR e'
  // la guardia, non una riscrittura della copy. Se il badge ricomparisse, la
  // frase tornerebbe a descrivere un prezzo inesistente.
  assert.equal(freeShippingBadgeCopy('it', 'EXTRA_EU').bodyKey, 'bodyExtraEu')
})

test('la pagina di checkout usa la guardia, non una condizione scritta a mano', () => {
  // Il test sopra prova la REGOLA; questo prova il CABLAGGIO. Sono due cose
  // diverse: la condizione nel JSX era `isExtraEuDestination && !shipping.isFree`
  // — due terzi dei termini — e nessun test della libreria poteva accorgersi che
  // il terzo mancava, perche' la pagina non e' importabile in un test di node.
  const page = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', '[locale]', 'checkout', 'page.tsx'),
    'utf8',
  )

  assert.ok(
    /import\s*\{[^}]*checkoutImportDutiesBadgeVisible[^}]*\}\s*from\s*'@\/lib\/free-shipping-badge'/.test(page),
    'il checkout deve importare la guardia da @/lib/free-shipping-badge',
  )
  assert.ok(
    page.includes('showImportDutiesBadge') && /\{showImportDutiesBadge && \(/.test(page),
    'il blocco del badge deve essere condizionato a showImportDutiesBadge',
  )
  // Gli argomenti si passano dal valore vero, non da una costante: la mutazione
  // `requiresQuote: false` lasciava il test verde finche' non si pinna anche la
  // forma della chiamata.
  assert.ok(
    /const showImportDutiesBadge = checkoutImportDutiesBadgeVisible\(\{\s*zone: baseShipping\.zone,\s*isFree: shipping\.isFree,\s*requiresQuote: baseShipping\.requiresQuote,\s*\}\)/.test(page),
    'la guardia deve ricevere zona, gratuita e requiresQuote dai valori calcolati dal checkout',
  )
  assert.ok(
    !/isExtraEuDestination && !shipping\.isFree/.test(page),
    'la vecchia condizione a due termini non deve piu\' decidere la visibilita\' del badge',
  )
})

test('gli importi si formattano nella lingua della pagina', () => {
  // La resa di prima, che non deve cambiare: la soglia e' tonda (`60`, `150`),
  // la tariffa ha i centesimi (`7,65` / `7.65`). Le due funzioni sono quelle di
  // `money.ts`: questo file non ne ha piu' una propria.
  assert.equal(formatWholeMoney('it', 60), '60')
  assert.equal(formatWholeMoney('en', 150), '150')
  assert.equal(formatMoney('it', 7.65), '7,65')
  assert.equal(formatMoney('en', 7.65), '7.65')
  assert.equal(formatMoney('fr', 14.99), '14,99')
  assert.equal(formatMoney('de', 14.99), '14,99')
  assert.equal(formatMoney('es', 7.65), '7,65')
  // Locale non prevista o con regione: si ricade sulla lingua, mai su undefined.
  assert.equal(normalizeBadgeLocale('it-IT'), 'it')
  assert.equal(normalizeBadgeLocale('PT'), 'it')
})

test('il badge non ha un formattatore proprio: la resa e\' quella di money.ts', () => {
  // Il difetto che questo test chiude: `free-shipping-badge.ts` costruiva un
  // `Intl.NumberFormat` con la lingua nuda (`it`, `en`, …) invece dei tag
  // espliciti di `money.ts` (`it-IT`, `en-GB`, …). Due formattatori nella
  // stessa pagina non si vedevano finche' la soglia resta un intero; la deriva
  // si sarebbe vista con una lingua nuova o con una soglia decimale.
  for (const locale of FREE_SHIPPING_BADGE_LOCALES) {
    const zone = badgeZoneForLocale(locale)
    const badge = freeShippingBadgeCopy(locale, zone)
    assert.equal(
      badge.amount,
      formatWholeMoney(locale, freeShippingThresholdEuros(zone)),
      `${locale}: la soglia del badge non e' la stringa di formatWholeMoney`,
    )
    // La promessa e' tonda: nessun decimale nel segnaposto, in nessuna lingua.
    assert.ok(
      !/[.,]\d/.test(String(badge.amount)),
      `${locale}: la soglia promessa ha dei decimali — «${String(badge.amount)}»`,
    )
  }

  // Una sola lista di lingue: quella di money.ts. Una lingua aggiunta al
  // negozio non deve esistere per il badge e non per gli importi.
  assert.deepEqual([...FREE_SHIPPING_BADGE_LOCALES], [...MONEY_LOCALES])

  // Le soglie configurate sono importi tondi: `formatWholeMoney` si ferma su un
  // valore con centesimi invece di arrotondarlo a una promessa piu' larga.
  for (const zone of ['IT', 'EU'] as const) {
    assert.ok(
      Number.isInteger(freeShippingThresholdEuros(zone)),
      `${zone}: la soglia deve essere un importo tondo, non ${freeShippingThresholdEuros(zone)}`,
    )
  }
})

test('la guardia sul sorgente: il badge non torna a un Intl con la lingua nuda', () => {
  // La resa identica si puo' ottenere in due modi — chiamando l'helper condiviso
  // o ricostruendo un formattatore locale che oggi rende uguale. Questo test
  // chiude il secondo.
  //
  // La guardia legge il sorgente GREZZO, commenti compresi: nessun filtro che
  // scarti righe. Un filtro del genere sembra comodo (i commenti di questi file
  // parlano del difetto) ma fallisce aperto: in TS una riga di codice puo'
  // iniziare con `*` (un metodo generatore, o la continuazione di una
  // moltiplicazione) e diventerebbe invisibile alla guardia. Misurato da una
  // review indipendente: con quel filtro una riga `*` costruiva il
  // formattatore e la suite restava 17/17 verde. Quindi: qui non si nomina il
  // formattatore nemmeno in prosa, e la guardia vieta i token, non le forme.
  //
  // Non basta cercare `new Intl.NumberFormat`: si chiama anche SENZA `new`
  // (ES2020), si puo' destrutturare (`const { NumberFormat } = Intl`), e un
  // import con alias lascerebbe libero il nome per una funzione locale: tutte
  // forme che reintroducevano il difetto con la suite verde.
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'lib', 'free-shipping-badge.ts'),
    'utf8',
  )

  assert.ok(
    !/\bIntl\b/.test(source),
    'free-shipping-badge.ts non deve nominare Intl (con o senza `new`, in un commento o in `globalThis`): i tag di lingua stanno in money.ts',
  )
  assert.ok(
    !/\bNumberFormat\b/.test(source),
    'free-shipping-badge.ts non deve nominare NumberFormat: ne\' per costruirlo, ne\' per destrutturarlo o dargli un alias',
  )
  assert.ok(
    !/toFixed|toLocaleString|globalThis/.test(source),
    "il badge non deve formattare da se': ne' `toFixed`, ne' `toLocaleString`, ne' `globalThis`",
  )
  assert.ok(
    !/(function|const|let|var)\s+formatWholeMoney\b/.test(source),
    'il badge non deve ridefinire localmente formatWholeMoney: deve usare quello di ./money',
  )
  assert.ok(
    !/formatBadgeAmount/.test(source),
    'il badge non deve riesportare un formattatore proprio: gli importi si chiedono a ./money',
  )
  // L'import si pinna nella forma esatta (niente alias, che libererebbe il nome).
  assert.ok(
    /import\s*\{\s*formatWholeMoney\s*\}\s*from\s*'\.\/money'/.test(source),
    'il badge deve importare formatWholeMoney da ./money con il suo nome, senza alias',
  )
  // Gli argomenti si pinnano: la soglia deve venire da `shipping.ts` e il locale
  // dalla pagina, non da una costante o da un `Intl` che indovina.
  assert.ok(
    /amount:\s*formatWholeMoney\(locale,\s*freeShippingThresholdEuros\(zone\)\)/.test(source),
    'la soglia deve passare per formatWholeMoney con la soglia di shipping.ts',
  )

  // La pagina dei termini (l'altro consumatore) formatta con `money.ts`: la
  // tariffa a due decimali e la soglia tonda.
  const termini = fs.readFileSync(
    path.join(process.cwd(), 'src', 'app', '[locale]', 'termini', 'page.tsx'),
    'utf8',
  )
  assert.ok(
    /cost:\s*formatMoney\(locale,\s*flatShippingCostEuros\('IT'\)\)/.test(termini) &&
      /cost:\s*formatMoney\(locale,\s*flatShippingCostEuros\('EU'\)\)/.test(termini),
    'i termini devono formattare la tariffa con formatMoney di @/lib/money',
  )
  assert.ok(
    /amount:\s*formatWholeMoney\(locale,\s*freeShippingThresholdEuros\('IT'\)\)/.test(termini) &&
      /amount:\s*formatWholeMoney\(locale,\s*freeShippingThresholdEuros\('EU'\)\)/.test(termini),
    'i termini devono formattare la soglia con formatWholeMoney di @/lib/money',
  )
  assert.ok(
    !/formatBadgeAmount/.test(termini),
    'i termini non devono usare un formattatore del badge: non esiste piu\'',
  )
})
