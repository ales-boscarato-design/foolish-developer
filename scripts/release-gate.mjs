#!/usr/bin/env node
// Gate pre-deploy FOOLISH: controlli strutturali che nessun test unitario copre.
//
//   node scripts/release-gate.mjs                 # in locale (controlla anche i lockfile)
//   node scripts/release-gate.mjs --ci            # in CI (i lockfile li prova l'install)
//   node scripts/release-gate.mjs --base origin/main
//
// Ogni controllo corrisponde a un difetto che si e' gia' presentato in produzione o a un
// contratto che si rompe in silenzio. Exit code 1 se un controllo fallisce.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
export const repoRoot = path.resolve(path.dirname(scriptPath), '..')

export const MESSAGES_LANGS = ['it', 'en', 'fr', 'es', 'de']

export const REQUIRED_FILES = [
  'cms/src/migrations/index.ts',
  'cms/src/payload.config.ts',
  'cms/src/payload-types.ts',
  'storefront/src/lib/promo.ts',
  'storefront/src/lib/stripe-orders.ts',
  'storefront/src/app/api/webhook/stripe/route.ts',
  ...MESSAGES_LANGS.map((lang) => `storefront/messages/${lang}.json`),
]

// I percorsi che leggono i metadata scritti dal checkout: se il checkout smette di
// scriverne una chiave, questi lettori degradano in silenzio (ordine senza nome,
// righe senza SKU) invece di fallire.
export const MONEY_PATH_READERS = [
  'storefront/src/lib/stripe-orders.ts',
  'storefront/src/app/api/webhook/stripe/route.ts',
  'storefront/src/app/api/webhook/printful-fulfillment/route.ts',
  'storefront/src/app/api/stripe/session/route.ts',
  'storefront/src/lib/affiliate-attribution.ts',
]

export const MONEY_PATH_WRITER = 'storefront/src/lib/promo.ts'
export const CHECKOUT_ROUTE = 'storefront/src/app/api/stripe/checkout/route.ts'

// Chiavi dei metadata di sessione del flusso ABBONAMENTO: quella sessione e' creata fuori
// dallo storefront (subscription_data.metadata) e non appartiene al contratto dell'ordine.
// Sono elencate qui, non ignorate in silenzio: se un giorno cambiano, si aggiorna questo punto.
export const SUBSCRIPTION_METADATA_KEYS = ['plan', 'zone', 'customerEmail']

const SECRET_PATTERNS = [
  ['chiave segreta Stripe', /\bsk_(live|test)_[A-Za-z0-9]{16,}/],
  ['signing secret Stripe', /\bwhsec_[A-Za-z0-9]{16,}/],
  ['restricted key Stripe', /\brk_(live|test)_[A-Za-z0-9]{16,}/],
  ['token fine-grained GitHub', /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ['token classico GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['chiave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['chiave API Google', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['token Slack', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['chiave privata PEM', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
]

const DEPLOY_PATTERNS = [
  ['railway up', /\brailway\s+up\b/],
  ['railway deploy', /\brailway\s+(deploy|redeploy)\b/],
  ['railway run/ssh', /\brailway\s+(run|ssh)\b/],
  ['payload migrate', /\bpayload\s+migrate\b/],
  ['migrate:status/esegui', /npm run migrate|yarn migrate|pnpm migrate/],
  ['vercel deploy', /\bvercel\s+(deploy|--prod)\b/],
  ['fly deploy', /\bfly(ctl)?\s+deploy\b/],
  ['netlify deploy', /\bnetlify\s+deploy\b/],
]

// ---------------------------------------------------------------- helper esportati

export const read = (relPath) => fs.readFileSync(path.join(repoRoot, relPath), 'utf8')

export function existingFiles(relPaths) {
  return relPaths.filter((rel) => fs.existsSync(path.join(repoRoot, rel)))
}

/** Nomi dei file di migration presenti su disco (escluso l'indice). */
export function extractMigrationNames() {
  const dir = path.join(repoRoot, 'cms/src/migrations')
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.replace(/\.ts$/, ''))
    .sort()
}

/** Nomi di migration registrati nell'indice (campo `name`). */
export function extractRegisteredMigrations(indexSource) {
  return [...indexSource.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]).sort()
}

/** Chiavi base dei metadata scritte da buildCheckoutMetadata (promo.ts). */
export function extractCheckoutBaseMetadataKeys(promoSource) {
  const fnStart = promoSource.indexOf('export function buildCheckoutMetadata')
  const body = fnStart === -1 ? '' : promoSource.slice(fnStart)
  const literal = [...body.matchAll(/^\s{4}([a-z_]+):/gm)].map((m) => m[1])
  const conditional = [...body.matchAll(/metadata\.([a-z_]+)\s*=/g)].map((m) => m[1])
  return [...new Set([...literal, ...conditional])].sort()
}

/** Chiavi che la route di checkout aggiunge ai metadata di sessione (es. affiliate_*). */
export function extractCheckoutRouteMetadataKeys(checkoutSource) {
  const start = checkoutSource.indexOf('const sessionMetadata')
  if (start === -1) return []
  const rest = checkoutSource.slice(start)
  // La regione e' il solo oggetto del ramo `? { ... }`, non tutta la chiamata a Stripe.
  const elseBranch = rest.match(/\n\s*:\s*metadata\b/)
  const region = elseBranch ? rest.slice(0, elseBranch.index) : rest
  return [...new Set([...region.matchAll(/^\s*([a-z_]+):\s/gm)].map((m) => m[1]))].sort()
}

/**
 * Chiavi lette dai metadata della sessione Stripe: `session.metadata.x` e gli alias
 * dichiarati come `const meta = session.metadata`. Esclude di proposito i metadata di
 * altri oggetti (es. `stripeSub.metadata.plan`) e gli oggetti locali omonimi.
 */
export function extractSessionMetadataReadKeys(sources) {
  const keys = new Set()
  for (const source of sources) {
    for (const m of source.matchAll(/session\.metadata\??\.([A-Za-z_]+)/g)) keys.add(m[1])
    for (const m of source.matchAll(/session\.metadata\??\[\s*['"]([A-Za-z_]+)['"]\s*\]/g)) keys.add(m[1])
    if (/const\s+meta\s*=\s*session\.metadata/.test(source)) {
      for (const m of source.matchAll(/\bmeta\??\.([A-Za-z_]+)/g)) keys.add(m[1])
      for (const m of source.matchAll(/\bmeta\??\[\s*['"]([A-Za-z_]+)['"]\s*\]/g)) keys.add(m[1])
    }
  }
  return [...keys].sort()
}

/** Tutti i percorsi foglia di un oggetto annidato (a.b.c). */
export function leafKeyPaths(value, prefix = '') {
  return Object.entries(value).flatMap(([key, child]) =>
    child && typeof child === 'object' && !Array.isArray(child)
      ? leafKeyPaths(child, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

export function scanForSecrets(files) {
  const findings = []
  for (const { path: relPath, content } of files) {
    for (const [label, pattern] of SECRET_PATTERNS) {
      if (pattern.test(content)) findings.push(`${relPath}: sembra contenere ${label}`)
    }
  }
  return findings
}

export function scanWorkflowForDeploy(files) {
  const findings = []
  for (const { path: relPath, content } of files) {
    const lines = content.split('\n')
    for (const [label, pattern] of DEPLOY_PATTERNS) {
      if (lines.some((line) => pattern.test(line) && !line.trimStart().startsWith('#'))) {
        findings.push(`${relPath}: comando di deploy/migration (${label})`)
      }
    }
  }
  return findings
}

/** Confronta le migration su disco con quelle registrate: nessuna orfana, nessun fantasma. */
export function compareMigrationRegistration(onDisk, registered) {
  const problems = []
  const unregistered = onDisk.filter((name) => !registered.includes(name))
  const ghosts = registered.filter((name) => !onDisk.includes(name))
  if (unregistered.length) problems.push(`non registrate in index.ts: ${unregistered.join(', ')}`)
  if (ghosts.length) problems.push(`registrate ma assenti su disco: ${ghosts.join(', ')}`)
  return problems
}

/** Confronta i set di chiavi foglia delle lingue contro l'italiano. */
export function compareLeafKeySets(setsByLang, baseLang = 'it') {
  const base = setsByLang[baseLang]
  const problems = []
  if (!base) return [`lingua base ${baseLang} assente`]
  for (const [lang, set] of Object.entries(setsByLang)) {
    if (lang === baseLang) continue
    const missing = [...base].filter((key) => !set.has(key))
    const extra = [...set].filter((key) => !base.has(key))
    if (missing.length) problems.push(`${lang}: mancano ${missing.length} chiavi (${missing.slice(0, 3).join(', ')})`)
    if (extra.length) problems.push(`${lang}: ${extra.length} chiavi non presenti in ${baseLang}`)
  }
  return problems
}

/** Ogni chiave letta dai percorsi "soldi" deve essere scritta dal checkout. */
export function compareMetadataContract(written, readsByFile) {
  const problems = []
  for (const { rel, keys } of readsByFile) {
    for (const key of keys) {
      if (!written.includes(key)) problems.push(`${key} (letto da ${rel})`)
    }
  }
  return problems
}

// ---------------------------------------------------------------- esecuzione

const args = process.argv.slice(2)
const inCi = args.includes('--ci')
const jsonOut = args.includes('--json')
const baseArg = args.indexOf('--base')
const baseRef = baseArg !== -1 ? args[baseArg + 1] : 'origin/main'

function git(extra) {
  const res = spawnSync('git', extra, { cwd: repoRoot, encoding: 'utf8' })
  return res.status === 0 ? res.stdout.trim() : null
}

function changedFiles() {
  const mergeBase = git(['merge-base', baseRef, 'HEAD'])
  if (!mergeBase) return null
  const out = git(['diff', '--name-only', `${mergeBase}..HEAD`])
  return out === null ? null : out.split('\n').filter(Boolean)
}

function runCheck(name, fn) {
  try {
    const result = fn()
    if (result === true || result === undefined) return { name, ok: true, detail: 'ok' }
    if (result === null) return { name, ok: true, detail: 'saltato (nessun riferimento di diff)' , skipped: true }
    return { name, ok: false, detail: Array.isArray(result) ? result.join(' | ') : String(result) }
  } catch (error) {
    return { name, ok: false, detail: `errore nel controllo: ${error.message}` }
  }
}

function checkRequiredFiles() {
  const missing = REQUIRED_FILES.filter((rel) => !fs.existsSync(path.join(repoRoot, rel)))
  return missing.length === 0 ? true : `file mancanti: ${missing.join(', ')}`
}

function checkMigrationRegistration() {
  const problems = compareMigrationRegistration(
    extractMigrationNames(),
    extractRegisteredMigrations(read('cms/src/migrations/index.ts')),
  )
  return problems.length === 0 ? true : problems.join(' | ')
}

function checkPushContract() {
  const source = read('cms/src/payload.config.ts')
  return /^\s*push:\s*false\s*,/m.test(source)
    ? true
    : 'payload.config.ts non ha piu` `push: false`: con push attivo lo schema viene sincronizzato senza migration'
}

function checkI18nParity() {
  const setsByLang = {}
  for (const lang of MESSAGES_LANGS) {
    const rel = `storefront/messages/${lang}.json`
    setsByLang[lang] = new Set(leafKeyPaths(JSON.parse(read(rel))))
  }
  const problems = compareLeafKeySets(setsByLang)
  return problems.length === 0 ? true : problems.join(' | ')
}

function checkMoneyMetadataContract() {
  const written = [
    ...extractCheckoutBaseMetadataKeys(read(MONEY_PATH_WRITER)),
    ...(fs.existsSync(path.join(repoRoot, CHECKOUT_ROUTE)) ? extractCheckoutRouteMetadataKeys(read(CHECKOUT_ROUTE)) : []),
  ]
  if (written.length === 0) return `nessuna chiave di metadata trovata in ${MONEY_PATH_WRITER}`
  const readsByFile = existingFiles(MONEY_PATH_READERS).map((rel) => ({
    rel,
    keys: extractSessionMetadataReadKeys([read(rel)]).filter((key) => !SUBSCRIPTION_METADATA_KEYS.includes(key)),
  }))
  const problems = compareMetadataContract(written, readsByFile)
  return problems.length === 0 ? true : `metadata scritti dal checkout assenti: ${problems.join(', ')}`
}

function checkGeneratedTypes() {
  const changed = changedFiles()
  if (changed === null) return null
  const touchedSchema = changed.some(
    (file) =>
      file === 'cms/src/payload.config.ts' ||
      (file.startsWith('cms/src/collections/') && file.endsWith('.ts')) ||
      (file.startsWith('cms/src/fields/') && file.endsWith('.ts')),
  )
  if (!touchedSchema) return true
  return changed.includes('cms/src/payload-types.ts')
    ? true
    : 'schema CMS modificato senza rigenerare cms/src/payload-types.ts (npx payload generate:types)'
}

function checkNoDeployInWorkflows() {
  const dir = path.join(repoRoot, '.github/workflows')
  if (!fs.existsSync(dir)) return true
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({ path: `.github/workflows/${f}`, content: fs.readFileSync(path.join(dir, f), 'utf8') }))
  const findings = scanWorkflowForDeploy(files)
  return findings.length === 0 ? true : findings.join(' | ')
}

function checkNoSecrets() {
  const changed = changedFiles()
  const relPaths =
    changed === null
      ? git(['ls-files'])
          ?.split('\n')
          .filter((f) => f && !f.startsWith('storefront/package-lock.json'))
      : changed
  if (!relPaths) return null
  const files = relPaths
    .filter((rel) => fs.existsSync(path.join(repoRoot, rel)))
    .filter((rel) => !/\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|pdf)$/i.test(rel))
    .filter((rel) => !/package-lock\.json$/.test(rel))
    .map((rel) => ({ path: rel, content: read(rel) }))
  const findings = scanForSecrets(files)
  return findings.length === 0 ? true : findings.join(' | ')
}

function checkLockfiles() {
  if (inCi) return null
  const problems = []
  for (const pkg of ['storefront', 'cms', 'b2b']) {
    const dir = path.join(repoRoot, pkg)
    if (!fs.existsSync(path.join(dir, 'package-lock.json'))) continue
    const res = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, npm_config_cache: path.join(process.env.TMPDIR || '/tmp', 'foolish-gate-npm-cache') },
    })
    if (res.status !== 0) {
      const detail = (res.stderr || res.stdout || '').split('\n').find((line) => /Missing:|EUSAGE|error/i.test(line))
      problems.push(`${pkg}: package-lock.json fuori sincrono con package.json (${(detail || '').trim().slice(0, 120)})`)
    }
  }
  return problems.length === 0 ? true : problems.join(' | ')
}

function main() {
  const checks = [
    runCheck('file richiesti presenti', checkRequiredFiles),
    runCheck('migration registrate in index.ts', checkMigrationRegistration),
    runCheck('contratto push:false su Payload', checkPushContract),
    runCheck('parita` chiavi i18n (5 lingue)', checkI18nParity),
    runCheck('metadata checkout -> percorsi soldi', checkMoneyMetadataContract),
    runCheck('tipi CMS rigenerati col cambio schema', checkGeneratedTypes),
    runCheck('nessun deploy/migration nei workflow', checkNoDeployInWorkflows),
    runCheck('nessun segreto nei file versionati', checkNoSecrets),
    runCheck('lockfile sincroni con package.json', checkLockfiles),
  ]

  const failures = checks.filter((c) => !c.ok)
  const skipped = checks.filter((c) => c.skipped)

  if (jsonOut) {
    console.log(JSON.stringify({ base: baseRef, checks, failures: failures.length }, null, 2))
  } else {
    console.log(`Gate pre-deploy FOOLISH (base: ${baseRef}${inCi ? ', modalita` CI' : ''})`)
    for (const check of checks) {
      const mark = check.skipped ? '-' : check.ok ? '✓' : '✗'
      console.log(`  ${mark} ${check.name}${check.ok ? '' : `\n      ${check.detail}`}`)
    }
    if (skipped.length) console.log(`  (${skipped.length} controlli saltati: manca il riferimento di diff)`)
    console.log(
      failures.length === 0
        ? `  ${checks.length - skipped.length} controlli superati`
        : `  ${failures.length} controlli falliti su ${checks.length - skipped.length}`,
    )
  }

  process.exit(failures.length === 0 ? 0 : 1)
}

const isMain = process.argv[1] ? path.resolve(process.argv[1]) === scriptPath : false
if (isMain) main()
