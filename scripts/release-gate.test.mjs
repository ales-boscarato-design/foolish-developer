// Test del gate: la logica pura si prova con casi negativi sintetici, poi si verifica
// che gli invarianti reali del repository reggano.
//
//   node --test scripts/release-gate.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import {
  repoRoot,
  MESSAGES_LANGS,
  MONEY_PATH_READERS,
  MONEY_PATH_WRITER,
  CHECKOUT_ROUTE,
  SUBSCRIPTION_METADATA_KEYS,
  extractMigrationNames,
  extractRegisteredMigrations,
  extractCheckoutBaseMetadataKeys,
  extractCheckoutRouteMetadataKeys,
  extractSessionMetadataReadKeys,
  leafKeyPaths,
  scanForSecrets,
  scanWorkflowForDeploy,
  compareMigrationRegistration,
  compareLeafKeySets,
  compareMetadataContract,
  read,
} from './release-gate.mjs'

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
  const findings = scanForSecrets([
    { path: 'x.ts', content: "const key = 'whsec_abcdefghijklmnop'" },
    { path: 'y.ts', content: 'const niente = 1' },
  ])
  assert.equal(findings.length, 1)
  assert.match(findings[0], /x\.ts/)
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
