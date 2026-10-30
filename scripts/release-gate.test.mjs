// Test del gate: la logica pura si prova con casi negativi sintetici, poi si verifica
// che gli invarianti reali del repository reggano.
//
//   node --test scripts/release-gate.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import {
  repoRoot,
  MESSAGES_LANGS,
  MONEY_PATH_READERS,
  MONEY_PATH_WRITER,
  CHECKOUT_ROUTE,
  REORDER_ROUTE,
  MONEY_METADATA_WRITER_ROUTES,
  CHECKOUT_SESSION_CREATOR_EXCLUSIONS,
  SUBSCRIPTION_METADATA_KEYS,
  GENERATED_TYPES_REL,
  extractMigrationNames,
  extractRegisteredMigrations,
  extractCheckoutBaseMetadataKeys,
  extractCheckoutRouteMetadataKeys,
  extractSessionMetadataReadKeys,
  findCheckoutSessionCreators,
  compareMoneyMetadataWriters,
  leafKeyPaths,
  scanForSecrets,
  scanWorkflowForDeploy,
  compareMigrationRegistration,
  compareLeafKeySets,
  compareMetadataContract,
  evaluateGeneratedTypes,
  isSchemaFile,
  read,
} from './release-gate.mjs'

// ------------------------------------------------- tipi CMS rigenerati

test('tipi rigenerati identici: nessun problema', () => {
  assert.equal(evaluateGeneratedTypes({ generated: 'done', before: 'x', after: 'x', changed: [] }), true)
})

test('un cambio che sposta i tipi generati viene segnalato', () => {
  // Una `option` in piu` su un select cambia l'unione dei literal: e` il caso che un
  // elenco di chiavi scritto a mano non vede (successo davvero in review).
  const detail = evaluateGeneratedTypes({ generated: 'done', before: 'x', after: 'y', changed: [] })
  assert.equal(typeof detail, 'string')
  assert.match(detail, /non corrisponde allo schema/)
})

test('se il generatore non e` installato si torna al controllo conservativo sul diff', () => {
  const missing = evaluateGeneratedTypes({
    generated: 'unavailable',
    changed: ['cms/src/collections/Products.ts'],
  })
  assert.equal(typeof missing, 'string')
  const covered = evaluateGeneratedTypes({
    generated: 'unavailable',
    changed: ['cms/src/collections/Products.ts', GENERATED_TYPES_REL],
  })
  assert.equal(covered, true)
  assert.equal(evaluateGeneratedTypes({ generated: 'unavailable', changed: ['README.md'] }), true)
  // Senza riferimento di diff il controllo si salta, ma dichiarandolo (non fingendo verde).
  assert.equal(
    evaluateGeneratedTypes({ generated: 'unavailable', changed: null }).skip,
    'generatore non installato e nessun riferimento di diff',
  )
})

test('una rigenerazione che tocca file inattesi sotto cms/ e` un errore', () => {
  // Caso vero: spostare `typescript.outputFile` nella config farebbe generare altrove e
  // il confronto sul percorso fisso resterebbe verde.
  const detail = evaluateGeneratedTypes({ generated: 'done', before: 'x', after: 'x', changed: [], dirty: true })
  assert.equal(typeof detail, 'string')
  assert.match(detail, /qualcosa e' cambiato nell'albero/)
  // Con il dettaglio di cosa e' comparso: serve a distinguere un output spostato da una
  // scrittura concorrente senza doverlo indovinare.
  assert.match(
    String(evaluateGeneratedTypes({ generated: 'done', before: 'x', after: 'x', changed: [], dirty: '?? probe.ts' })),
    /\?\? probe\.ts/,
  )
})

test('se il generatore non riscrive il file canonico il controllo e` rosso', () => {
  // Verificato con la sentinella: nessuna grafia della chiave `outputFile` puo` ingannare
  // il controllo, perche` non si legge la config: si guarda quale file viene riscritto.
  const detail = evaluateGeneratedTypes({
    generated: 'done',
    before: 'x',
    after: 'x',
    changed: [],
    dirty: false,
    wroteCanonical: false,
  })
  assert.equal(typeof detail, 'string')
  assert.match(detail, /non e' il file che il generatore riscrive/)
})

test('con il file canonico riscritto e contenuto in sincrono il controllo e` verde', () => {
  assert.equal(
    evaluateGeneratedTypes({
      generated: 'done',
      before: 'x',
      after: 'x',
      changed: [],
      dirty: false,
      wroteCanonical: true,
    }),
    true,
  )
})

test('un generatore che fallisce non vale come controllo verde', () => {
  assert.equal(typeof evaluateGeneratedTypes({ generated: 'failed', changed: [] }), 'string')
  // Un binario che non parte non e' una config sbagliata: il messaggio non deve mandare a
  // cercare la' dove non c'e' niente.
  const detail = evaluateGeneratedTypes({ generated: 'done', changed: [], spawnFailed: true })
  assert.match(String(detail), /generatore assente o in errore/)
})

test('PAYLOAD_TS_OUTPUT_PATH viene segnalata invece di essere ignorata', () => {
  process.env.PAYLOAD_TS_OUTPUT_PATH = './altrove/payload-types.ts'
  try {
    const detail = evaluateGeneratedTypes({ generated: 'done', before: 'x', after: 'x', changed: [], dirty: false, wroteCanonical: true })
    assert.equal(typeof detail, 'string')
    assert.match(detail, /PAYLOAD_TS_OUTPUT_PATH/)
  } finally {
    delete process.env.PAYLOAD_TS_OUTPUT_PATH
  }
})

test('i file di schema sono quelli da cui Payload genera i tipi', () => {
  assert.equal(isSchemaFile('cms/src/collections/Products.ts'), true)
  assert.equal(isSchemaFile('cms/src/fields/slug.ts'), true)
  assert.equal(isSchemaFile('cms/src/payload.config.ts'), true)
  assert.equal(isSchemaFile('cms/src/collections/Orders.test.ts'), true)
  assert.equal(isSchemaFile('storefront/src/lib/legacy-slugs.ts'), false)
  assert.equal(isSchemaFile('cms/src/migrations/index.ts'), false)
})

// ------------------------------------------------------------------ casi negativi

test('una migration non registrata viene segnalata', () => {
  const problems = compareMigrationRegistration(
    ['20260101_000000_a', '20260102_000000_b_nuova'],
    ['20260101_000000_a'],
  )
  assert.equal(problems.length, 1)
  assert.match(problems[0], /20260102_000000_b_nuova/)
})

test('una migration registrata ma assente su disco viene segnalata', () => {
  const problems = compareMigrationRegistration(['a'], ['a', 'fantasma'])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /fantasma/)
})

test('migration allineate non producono problemi', () => {
  assert.deepEqual(compareMigrationRegistration(['a', 'b'], ['b', 'a']), [])
})

test('una chiave di traduzione mancante in una lingua viene segnalata', () => {
  const problems = compareLeafKeySets({
    it: new Set(['home.title', 'cart.total']),
    es: new Set(['home.title']),
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /es: mancano 1 chiavi/)
})

test('una chiave in piu` rispetto all italiano viene segnalata', () => {
  const problems = compareLeafKeySets({
    it: new Set(['home.title']),
    fr: new Set(['home.title', 'solo.in.francese']),
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /non presenti in it/)
})

test('chiavi identiche non producono problemi', () => {
  const keys = new Set(['a.b', 'a.c'])
  assert.deepEqual(compareLeafKeySets({ it: keys, de: new Set(['a.b', 'a.c']) }), [])
})

test('una chiave di metadata letta ma non scritta viene segnalata', () => {
  const problems = compareMetadataContract(['order_ref', 'items_json'], [
    { rel: 'storefront/src/lib/stripe-orders.ts', keys: ['order_ref', 'customer_name'] },
  ])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /customer_name/)
})

test('contratto metadata rispettato non produce problemi', () => {
  assert.deepEqual(
    compareMetadataContract(['order_ref', 'customer_name'], [
      { rel: 'storefront/src/app/api/webhook/stripe/route.ts', keys: ['order_ref'] },
    ]),
    [],
  )
})

// --------------------------- scrittori di metadata monetari (riordino incluso)

const SUBSCRIBE_ROUTE = 'storefront/src/app/api/subscribe/checkout/route.ts'

const NOMINAL_SOURCES = {
  [CHECKOUT_ROUTE]:
    "const metadata = buildCheckoutMetadata({ orderRef })\n"
    + "await stripe.checkout.sessions.create({ mode: 'payment', metadata })",
  // La rotta e' sottile: la chiamata vera vive nel modulo che importa.
  [REORDER_ROUTE]:
    "return handleReorder({ orderId, sessionEmail })\n"
    + "// storefront/src/lib/reorder.ts\n"
    + "const metadata = buildCheckoutMetadata({ orderRef })\n"
    + "await stripe.checkout.sessions.create({ mode: 'payment', metadata })",
  [SUBSCRIBE_ROUTE]:
    "await stripe.checkout.sessions.create({ mode: 'subscription', subscription_data: { metadata } })",
}

const NOMINAL_FILES = Object.entries(NOMINAL_SOURCES).map(([path, content]) => ({ path, content }))

test('(i) una lista che perde la rotta di riordino e` rossa e nomina la rotta', () => {
  const creators = findCheckoutSessionCreators(NOMINAL_FILES)
  assert.ok(creators.includes(REORDER_ROUTE), 'il caso sintetico deve contenere la rotta di riordino')

  // La rotta esiste ancora: e' solo sparita dalla lista dichiarata. Il gate non
  // deve diventare verde per omissione.
  const problems = compareMoneyMetadataWriters(creators, [CHECKOUT_ROUTE], NOMINAL_SOURCES)
  assert.ok(
    problems.some((problem) => problem.includes(REORDER_ROUTE)),
    `nessun problema nomina ${REORDER_ROUTE}: ${problems.join(' | ')}`,
  )
})

test('(ii) una rotta che scrive metadata a mano invece di buildCheckoutMetadata e` rossa', () => {
  // Sorgenti realistiche: fra i moduli locali c'e` la definizione VERA di
  // buildCheckoutMetadata (promo.ts), come nel gate sul repository. Con un
  // controllo che cerca solo il nome della funzione questo caso resterebbe
  // verde: il test deve fallire se il controllo torna vacuo.
  const sources = {
    ...NOMINAL_SOURCES,
    [REORDER_ROUTE]:
      "await stripe.checkout.sessions.create({ metadata: { order_ref: 'FOOLISH-1' } })\n"
      + read(MONEY_PATH_WRITER),
  }
  const creators = findCheckoutSessionCreators(
    Object.entries(sources).map(([path, content]) => ({ path, content })),
  )
  const problems = compareMoneyMetadataWriters(creators, MONEY_METADATA_WRITER_ROUTES, sources)
  assert.ok(
    problems.some((problem) => problem.includes(REORDER_ROUTE) && /buildCheckoutMetadata/.test(problem)),
    `nessun problema di metadata a mano: ${problems.join(' | ')}`,
  )
})

test('(v) una rotta che chiama davvero buildCheckoutMetadata({...}) resta verde con la definizione fra le sorgenti', () => {
  const sources = {
    ...NOMINAL_SOURCES,
    [REORDER_ROUTE]:
      "const metadata = buildCheckoutMetadata({ orderRef, customer, chargedProductLines })\n"
      + "await stripe.checkout.sessions.create({ mode: 'payment', metadata })\n"
      + read(MONEY_PATH_WRITER),
  }
  const creators = findCheckoutSessionCreators(
    Object.entries(sources).map(([path, content]) => ({ path, content })),
  )
  assert.deepEqual(
    compareMoneyMetadataWriters(creators, MONEY_METADATA_WRITER_ROUTES, sources),
    [],
  )
})

test('(iii) caso nominale: checkout e riordino dichiarati sono verdi', () => {
  const creators = findCheckoutSessionCreators(NOMINAL_FILES)
  assert.deepEqual(
    compareMoneyMetadataWriters(creators, MONEY_METADATA_WRITER_ROUTES, NOMINAL_SOURCES),
    [],
  )
})

test('(iv) la rotta esclusa dell abbonamento non produce problemi', () => {
  assert.ok(Object.hasOwn(CHECKOUT_SESSION_CREATOR_EXCLUSIONS, SUBSCRIBE_ROUTE))
  const creators = findCheckoutSessionCreators([
    { path: SUBSCRIBE_ROUTE, content: NOMINAL_SOURCES[SUBSCRIBE_ROUTE] },
  ])
  assert.deepEqual(
    compareMoneyMetadataWriters(creators, [], { [SUBSCRIBE_ROUTE]: NOMINAL_SOURCES[SUBSCRIBE_ROUTE] }),
    [],
  )
})

test('nel repository la rotta di riordino fa parte degli scrittori dichiarati', () => {
  assert.ok(MONEY_METADATA_WRITER_ROUTES.includes(REORDER_ROUTE))
  assert.ok(fs.existsSync(path.join(repoRoot, REORDER_ROUTE)))
})

test('le chiavi di metadata si estraggono da scritture dirette e condizionali', () => {
  const source = `
export function buildCheckoutMetadata(args: { x: string }): Record<string, string> | null {
  const metadata: Record<string, string> = {
    order_ref: args.x,
    items_json: '[]',
  }
  if (args.x) {
    metadata.promo_code = 'X'
  }
  return metadata
}
`
  const keys = extractCheckoutBaseMetadataKeys(source)
  assert.deepEqual(keys, ['items_json', 'order_ref', 'promo_code'])
})

test('le chiavi aggiunte dalla route di checkout vengono lette', () => {
  const source = `
  const shouldMarkAffiliate = await shouldMarkAffiliateCheckoutPromo(promoRecord)
  const sessionMetadata = shouldMarkAffiliate && promo
    ? {
        ...metadata,
        affiliate_id: String(shouldMarkAffiliate.affiliateId),
        affiliate_slug: shouldMarkAffiliate.affiliateSlug,
      }
    : metadata
  const session = await stripe.checkout.sessions.create({ metadata: sessionMetadata })
`
  assert.deepEqual(extractCheckoutRouteMetadataKeys(source), ['affiliate_id', 'affiliate_slug'])
})

test('le chiavi di altri oggetti metadata non vengono confuse con quelle della sessione', () => {
  const keys = extractSessionMetadataReadKeys([
    'const plan = stripeSub.metadata.plan as PlanKey\nconst zone = stripeSub.metadata.zone',
    'const snapshot = { code: metadata.code, eligibleAmountCents: metadata.eligibleAmountCents }',
  ])
  assert.deepEqual(keys, [])
})

test('i nomi di chiave con maiuscole si estraggono interi (customerEmail, non customer)', () => {
  const keys = extractSessionMetadataReadKeys([
    'const meta = session.metadata ?? {}\nconst email = meta.customerEmail',
  ])
  assert.deepEqual(keys, ['customerEmail'])
  assert.ok(SUBSCRIPTION_METADATA_KEYS.includes('customerEmail'))
})

test('l oggetto del ramo condizionale non trascina le chiavi della chiamata a Stripe', () => {
  const source = `
  const sessionMetadata = affiliate && promo
    ? {
        ...metadata,
        affiliate_id: String(affiliate.affiliateId),
      }
    : metadata
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    metadata: sessionMetadata,
  })
`
  assert.deepEqual(extractCheckoutRouteMetadataKeys(source), ['affiliate_id'])
})

test('le chiavi della sessione si estraggono anche tramite alias meta', () => {
  const keys = extractSessionMetadataReadKeys([
    'const meta = session.metadata ?? {}\nconst ref = meta.order_ref\nconst name = meta.customer_name',
    'const x = args.session.metadata?.affiliate_slug',
  ])
  assert.deepEqual(keys, ['affiliate_slug', 'customer_name', 'order_ref'])
})

test('i percorsi foglia annidati vengono appiattiti', () => {
  assert.deepEqual(leafKeyPaths({ a: { b: 1, c: { d: 2 } }, e: 3 }).sort(), ['a.b', 'a.c.d', 'e'])
})

test('un segreto in un file viene rilevato', () => {
  // Il valore finto si compone a runtime: il file di test non deve contenere per davvero
  // una stringa che sembra un segreto, o il gate segnala se stesso (giusto).
  const fakeWebhookSecret = ['whsec', 'abcdefghijklmnop'].join('_')
  const findings = scanForSecrets([
    { path: 'x.ts', content: `const key = '${fakeWebhookSecret}'` },
    { path: 'y.ts', content: 'const niente = 1' },
  ])
  assert.equal(findings.length, 1)
  assert.match(findings[0], /x\.ts/)
})

test('i file del gate non contengono stringhe che sembrano segreti', () => {
  const dir = path.join(repoRoot, 'scripts')
  const files = fs
    .readdirSync(dir)
    .map((name) => ({ path: name, content: fs.readFileSync(path.join(dir, name), 'utf8') }))
  assert.deepEqual(scanForSecrets(files), [])
})

test('codice pulito non produce falsi positivi sui segreti', () => {
  const findings = scanForSecrets([
    { path: 'z.ts', content: "const stripeKey = process.env.STRIPE_SECRET_KEY\nconst mask = 'sk_live_...'" },
  ])
  assert.deepEqual(findings, [])
})

test('un comando di deploy in un workflow viene rilevato', () => {
  const findings = scanWorkflowForDeploy([
    { path: '.github/workflows/ci.yml', content: 'steps:\n  - run: railway up --service Storefront\n' },
    { path: '.github/workflows/alt.yml', content: 'steps:\n  - run: npx payload migrate\n' },
  ])
  assert.equal(findings.length, 2)
})

test('un workflow di soli test non viene segnalato', () => {
  const findings = scanWorkflowForDeploy([
    {
      path: '.github/workflows/ci.yml',
      content: 'steps:\n  - run: npm ci --ignore-scripts\n  - run: npm test\n  - run: npx tsc --noEmit\n',
    },
    { path: '.github/workflows/note.yml', content: '# railway up resta un passo manuale\n' },
  ])
  assert.deepEqual(findings, [])
})

// ------------------------------------------------------- invarianti del repository

test('tutte le migration su disco sono registrate', () => {
  const problems = compareMigrationRegistration(
    extractMigrationNames(),
    extractRegisteredMigrations(read('cms/src/migrations/index.ts')),
  )
  assert.deepEqual(problems, [])
})

test('il numero di migration registrate coincide con i file su disco', () => {
  const onDisk = extractMigrationNames()
  const registered = extractRegisteredMigrations(read('cms/src/migrations/index.ts'))
  assert.ok(onDisk.length > 0, 'nessuna migration trovata su disco')
  assert.equal(registered.length, onDisk.length)
})

test('payload-types.ts corrisponde allo schema (rigenerazione vera)', () => {
  // Il controllo del gate gira sullo stesso generatore: qui si prova l'invariante
  // reale, che nessun elenco di chiavi scritto a mano puo` sostituire.
  const bin = path.join(repoRoot, 'cms', 'node_modules', '.bin', 'payload')
  if (!fs.existsSync(bin)) return // generatore non installato: resta il controllo del gate
  const typesPath = path.join(repoRoot, GENERATED_TYPES_REL)
  const before = fs.readFileSync(typesPath, 'utf8')
  const res = spawnSync(bin, ['generate:types'], { cwd: path.join(repoRoot, 'cms'), encoding: 'utf8' })
  const after = fs.readFileSync(typesPath, 'utf8')
  if (after !== before) fs.writeFileSync(typesPath, before)
  assert.equal(res.status, 0, 'payload generate:types e` fallito')
  assert.equal(after, before, `${GENERATED_TYPES_REL} fuori sincrono con lo schema`)
})

test('il checkout scrive tutte le chiavi di metadata che i percorsi soldi leggono', () => {
  const written = [
    ...extractCheckoutBaseMetadataKeys(read(MONEY_PATH_WRITER)),
    ...extractCheckoutRouteMetadataKeys(read(CHECKOUT_ROUTE)),
  ]
  const readsByFile = MONEY_PATH_READERS.filter((rel) => fs.existsSync(path.join(repoRoot, rel))).map((rel) => ({
    rel,
    keys: extractSessionMetadataReadKeys([read(rel)]).filter((key) => !SUBSCRIPTION_METADATA_KEYS.includes(key)),
  }))
  assert.deepEqual(compareMetadataContract(written, readsByFile), [])
  for (const key of ['order_ref', 'customer_name', 'items_json', 'affiliate_id', 'affiliate_slug']) {
    assert.ok(written.includes(key), `manca ${key} fra i metadata scritti dal checkout`)
  }
  const readKeys = new Set(readsByFile.flatMap((entry) => entry.keys))
  for (const key of ['promo_code', 'affiliate_promo_code']) {
    assert.ok(readKeys.has(key), `${key} viene letta dai percorsi soldi ma non e' piu' estratta`)
  }
})

test('le cinque lingue hanno le stesse chiavi', () => {
  const setsByLang = {}
  for (const lang of MESSAGES_LANGS) {
    setsByLang[lang] = new Set(leafKeyPaths(JSON.parse(read(`storefront/messages/${lang}.json`))))
  }
  assert.deepEqual(compareLeafKeySets(setsByLang), [])
})

test('nessun workflow del repository esegue deploy o migration', () => {
  const dir = path.join(repoRoot, '.github/workflows')
  if (!fs.existsSync(dir)) return
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ path: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }))
  assert.deepEqual(scanWorkflowForDeploy(files), [])
})
