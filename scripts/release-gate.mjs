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
import { randomUUID } from 'node:crypto'
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
export const REORDER_ROUTE = 'storefront/src/app/api/account/reorder/[orderId]/route.ts'
export const MONEY_METADATA_WRITER_ROUTES = [CHECKOUT_ROUTE, REORDER_ROUTE]

// La sessione dell'ABBONAMENTO e' creata con `subscription_data.metadata`: non e' il
// contratto dell'ordine e non scrive i metadata monetari letti dal webhook. E' elencata
// qui, con la ragione, invece di essere ignorata in silenzio.
export const CHECKOUT_SESSION_CREATOR_EXCLUSIONS = {
  'storefront/src/app/api/subscribe/checkout/route.ts':
    'sessione abbonamento creata con subscription_data.metadata: non e\' il contratto dell\'ordine',
}

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

/**
 * I file che creano davvero una Checkout Session. Il criterio e' testuale e
 * volutamente semplice: un elenco di rotte scritto a mano invecchia, mentre una
 * chiamata nuova a `checkout.sessions.create(` compare da sola.
 */
export function findCheckoutSessionCreators(files) {
  return [...new Set(
    files
      .filter(({ content }) => /\bcheckout\.sessions\.create\s*\(/.test(content))
      .map(({ path: rel }) => rel),
  )].sort()
}

/**
 * Confronta i creatori di Checkout Session con la lista dichiarata degli
 * scrittori di metadata monetari. Il controllo e' autoimposto:
 *   (a) un creatore non dichiarato e non escluso e' un problema;
 *   (b) un percorso dichiarato che non esiste e' un problema;
 *   (c) un percorso dichiarato che non crea sessioni e' una lista disonesta;
 *   (d) un percorso dichiarato che scrive metadata senza un SITO DI CHIAMATA a
 *       `buildCheckoutMetadata({ ... })` e' un problema: le chiavi devono venire
 *       dalla funzione condivisa. Il criterio e' la chiamata con l'oggetto
 *       letterale, non la definizione (`buildCheckoutMetadata(args: {...})`):
 *       le sorgenti includono `promo.ts`, dove la funzione e' definita, quindi
 *       cercare solo il nome renderebbe il controllo sempre verde.
 * `sourcesByPath` per una rotta puo' includere i suoi moduli locali (il gate
 * reale li segue), cosi' una rotta sottile che delega resta verificabile.
 */
export function compareMoneyMetadataWriters(creators, declared, sourcesByPath = {}) {
  const problems = []
  const excluded = new Set(Object.keys(CHECKOUT_SESSION_CREATOR_EXCLUSIONS))
  const declaredSet = new Set(declared)
  const buildCheckoutMetadataCall = /buildCheckoutMetadata\(\s*\{/

  for (const rel of creators) {
    if (!declaredSet.has(rel) && !excluded.has(rel)) {
      problems.push(`${rel}: crea una Checkout Session ma non e' dichiarato in MONEY_METADATA_WRITER_ROUTES`)
    }
  }

  for (const rel of declared) {
    const source = sourcesByPath[rel]
    if (typeof source !== 'string') {
      problems.push(`${rel}: dichiarato scrittore di metadata monetari ma il file non esiste`)
    } else if (!creators.includes(rel)) {
      problems.push(`${rel}: dichiarato scrittore di metadata monetari ma non crea Checkout Session`)
    } else if (!buildCheckoutMetadataCall.test(source)) {
      problems.push(`${rel}: metadata scritti a mano invece della funzione condivisa buildCheckoutMetadata`)
    }
  }

  return problems
}

export const SCHEMA_FILES_RE = /^cms\/src\/(?:collections|fields)\/.*\.ts$/
export const GENERATED_TYPES_REL = 'cms/src/payload-types.ts'
/**
 * Marcatore scritto nel file canonico per vedere se il generatore lo riscrive. La parte
 * casuale non puo' comparire nei tipi generati (nemmeno da una `admin.description`), cosi'
 * il criterio non produce falsi positivi.
 *
 * Limite dichiarato del controllo: `payload.config.ts` e' codice, non dati. Un IIFE o un
 * `typescript.postProcess` scritto apposta puo' fabbricare l'evidenza (riscrivere il file
 * canonico o restituire il contenuto committato). Nessun controllo che esegue la config nel
 * proprio processo se ne difende; si vedrebbe comunque nel diff della PR.
 */
export const GENERATED_TYPES_SENTINEL_PREFIX = '// gate-sentinel '
const SENTINEL_LINE = /^\s*\/\/ gate-sentinel [0-9a-f-]{8,}\s*$/gm

/** Un file da cui Payload genera i tipi. */
export function isSchemaFile(rel) {
  return rel === 'cms/src/payload.config.ts' || SCHEMA_FILES_RE.test(rel)
}

/**
 * Esito del controllo sui tipi generati, senza toccare il disco: cosi' si prova con
 * casi sintetici invece che solo sul repository.
 *
 * La verifica buona e' rigenerare `payload-types.ts` dallo schema e confrontarlo: un
 * elenco di chiavi "che cambiano i tipi" non puo' essere completo (una `option` in piu'
 * su un `select` cambia l'unione dei literal senza toccare `name`/`type`), quindi il
 * controllo statico si usa solo dove il generatore non e' installato.
 *
 * Limite noto, non un buco di questo controllo: un cambio che non sposta i tipi (per
 * esempio `localized: true -> false`) lascia il file identico e passa. Il controllo
 * risponde di una cosa sola - "i tipi corrispondono allo schema" - e quella cosa la
 * verifica per intero.
 */
export function evaluateGeneratedTypes({ generated, before, after, changed, dirty, wroteCanonical, spawnFailed }) {
  // Prima le cause che manderebbero a cercare nel posto sbagliato: se il generatore non e'
  // partito, non e' la config a essere sbagliata.
  if (spawnFailed || generated === 'failed') {
    const env = process.env.PAYLOAD_TS_OUTPUT_PATH ? '; PAYLOAD_TS_OUTPUT_PATH e\' impostata e vince sulla config' : ''
    return `non e' stato possibile rigenerare ${GENERATED_TYPES_REL} dallo schema (generatore assente o in errore${env})`
  }
  if (process.env.PAYLOAD_TS_OUTPUT_PATH) {
    return `PAYLOAD_TS_OUTPUT_PATH e' impostata nell'ambiente: payload scrive la' i tipi e vince sulla config, quindi ${GENERATED_TYPES_REL} non e' il file da confrontare`
  }
  // Empirico: il file canonico E' l'output del generatore? Nessun parsing della config puo'
  // dirlo meglio (chiavi calcolate, spread, commenti-esca non lo ingannano).
  if (wroteCanonical === false) {
    return `${GENERATED_TYPES_REL} non e' il file che il generatore riscrive: l'output dei tipi e' dichiarato altrove. Il confronto qui sotto guarderebbe un file fermo`
  }
  if (dirty) {
    const detail = typeof dirty === 'string' ? ` (${dirty})` : ''
    return `qualcosa e' cambiato nell'albero intorno alla rigenerazione${detail}: il percorso di output si legge dallo schema, quindi il confronto non e' affidabile. Se il file non e' tuo, e' una scrittura concorrente: rilancia il gate`
  }
  if (generated === 'unavailable') {
    if (changed == null) return { skip: 'generatore non installato e nessun riferimento di diff' }
    const schemaTouched = changed.some(isSchemaFile)
    if (!schemaTouched) return true
    return changed.includes(GENERATED_TYPES_REL)
      ? true
      : `${GENERATED_TYPES_REL} non nel diff mentre lo schema CMS cambia (generatore non installato: qui il controllo e' quello conservativo sul diff)`
  }
  return before === after
    ? true
    : `${GENERATED_TYPES_REL} non corrisponde allo schema: rigenera con \`cd cms && npx payload generate:types\` e committa il file`
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
    if (result === null) return { name, ok: true, detail: 'saltato', skipped: true, skip: 'non applicabile in questo contesto' }
    if (typeof result === 'object' && typeof result.skip === 'string') {
      return { name, ok: true, detail: `saltato: ${result.skip}`, skipped: true, skip: result.skip }
    }
    return { name, ok: false, detail: Array.isArray(result) ? result.join(' | ') : String(result) }
  } catch (error) {
    return { name, ok: false, detail: `errore nel controllo: ${error.message}` }
  }
}

/**
 * Stato git dell'albero: serve ad accorgersi di cio' che la rigenerazione tocca davvero.
 * `null` se git non risponde: un albero non osservabile non e' un albero pulito.
 */
function repositoryStatus() {
  return git(['status', '--porcelain=v1', '--untracked-files=all'])
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

const STOREFRONT_SRC = 'storefront/src'
const SOURCE_FILE_RE = /\.(?:ts|tsx)$/
const SOURCE_TEST_FILE_RE = /\.test\.(?:ts|tsx)$/

/** Tutti i sorgenti applicativi dello storefront (i test non creano sessioni). */
function listStorefrontSources() {
  const root = path.join(repoRoot, STOREFRONT_SRC)
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (SOURCE_FILE_RE.test(entry.name) && !SOURCE_TEST_FILE_RE.test(entry.name)) {
        out.push(path.relative(repoRoot, full).split(path.sep).join('/'))
      }
    }
  }
  if (fs.existsSync(root)) walk(root)
  return out.sort()
}

function localImportSpecifiers(source) {
  return [...source.matchAll(/(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
}

function resolveLocalImport(fromRel, spec, sourcesByPath) {
  let base
  if (spec.startsWith('@/')) {
    base = `${STOREFRONT_SRC}/${spec.slice(2)}`
  } else if (spec.startsWith('.')) {
    base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
  } else {
    return null
  }
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
    .find((candidate) => Object.prototype.hasOwnProperty.call(sourcesByPath, candidate)) ?? null
}

/**
 * Sorgente di una rotta PIU' i moduli locali che importa. Serve perche' la rotta
 * di riordino e' volutamente sottile: la chiamata a Stripe e la costruzione dei
 * metadata vivono in `lib/reorder.ts`, e il gate deve verificarle la' dove sono.
 */
function collectLocalSource(rel, sourcesByPath, seen = new Set()) {
  if (seen.has(rel)) return ''
  seen.add(rel)
  const own = sourcesByPath[rel] ?? ''
  const children = localImportSpecifiers(own)
    .map((spec) => resolveLocalImport(rel, spec, sourcesByPath))
    .filter(Boolean)
  return [
    own,
    ...children.map((child) => collectLocalSource(child, sourcesByPath, seen)),
  ].join('\n')
}

/** Mappa inversa: modulo locale -> file che lo importano. */
function buildImporterMap(sourcesByPath) {
  const importers = new Map()
  for (const [rel, source] of Object.entries(sourcesByPath)) {
    for (const spec of localImportSpecifiers(source)) {
      const target = resolveLocalImport(rel, spec, sourcesByPath)
      if (!target) continue
      if (!importers.has(target)) importers.set(target, new Set())
      importers.get(target).add(rel)
    }
  }
  return importers
}

/**
 * Risale dagli import al file di rotta che possiede il codice. Serve quando la
 * rotta e' sottile: il creatore e' `lib/reorder.ts`, ma il percorso che deve
 * comparire in un messaggio d'errore e' la rotta che lo importa.
 */
function owningRoute(rel, importers, seen = new Set()) {
  if (/(?:^|\/)route\.(?:ts|tsx)$/.test(rel)) return rel
  if (seen.has(rel)) return null
  seen.add(rel)
  for (const importer of importers.get(rel) ?? []) {
    const owner = owningRoute(importer, importers, seen)
    if (owner) return owner
  }
  return null
}

/**
 * I creatori di Checkout Session devono coincidere con gli scrittori di metadata
 * monetari dichiarati. La rotta di riordino e' inclusa perche' scrive gli stessi
 * metadata dell'ordine: se qualcuno toglie la rotta dalla lista, il controllo
 * resta rosso finche' il file esiste e crea sessioni.
 */
function checkMoneyMetadataWriters() {
  const sourcePaths = listStorefrontSources()
  const sourcesByPath = Object.fromEntries(sourcePaths.map((rel) => [rel, read(rel)]))
  const creators = findCheckoutSessionCreators(
    sourcePaths.map((rel) => ({ path: rel, content: sourcesByPath[rel] })),
  )
  if (creators.length === 0) return `nessuna Checkout Session trovata sotto ${STOREFRONT_SRC}`

  const declaredSources = {}
  const ownerByPath = new Map()
  for (const rel of MONEY_METADATA_WRITER_ROUTES) {
    const seen = new Set()
    declaredSources[rel] = collectLocalSource(rel, sourcesByPath, seen)
    for (const file of seen) {
      if (!ownerByPath.has(file)) ownerByPath.set(file, rel)
    }
  }

  // Attribuisce un modulo locale alla rotta dichiarata che lo importa: il
  // creatore "vero" e' la rotta, non il file di libreria che la serve. Se la
  // rotta e' stata tolta dalla lista, l'import graph la ritrova comunque e il
  // messaggio la nomina (invece di far sembrare il problema un file di lib).
  const importers = buildImporterMap(sourcesByPath)
  const attributedCreators = [...new Set(
    creators.map((rel) => ownerByPath.get(rel) ?? owningRoute(rel, importers) ?? rel),
  )].sort()
  const problems = compareMoneyMetadataWriters(
    attributedCreators,
    MONEY_METADATA_WRITER_ROUTES,
    declaredSources,
  )
  return problems.length === 0 ? true : problems.join(' | ')
}

/**
 * Rigenera i tipi dallo schema e verifica empiricamente due cose: che il file canonico sia
 * davvero l'output del generatore (sentinella) e che il contenuto sia in sincrono.
 *
 * Il file viene rimesso com'era in ogni percorso: errore, generatore che lo cancella, e
 * segnali (`try/finally` non li intercetta). Una sentinella rimasta da un'esecuzione
 * interrotta viene tolta all'inizio, cosi' un Ctrl-C non lascia righe estranee nel file
 * tracciato.
 */
function regenerateTypes() {
  const cmsDir = path.join(repoRoot, 'cms')
  const bin = path.join(cmsDir, 'node_modules', '.bin', 'payload')
  const typesPath = path.join(repoRoot, GENERATED_TYPES_REL)
  if (!fs.existsSync(bin) || !fs.existsSync(typesPath)) return { generated: 'unavailable' }

  const committed = fs.readFileSync(typesPath, 'utf8')
  const before = committed.replace(SENTINEL_LINE, '')
  const statusBefore = repositoryStatus()
  const sentinel = `${GENERATED_TYPES_SENTINEL_PREFIX}${randomUUID()}`

  const restore = () => {
    try {
      // Sempre, anche se il file non c'e' piu': `existsSync` lascerebbe una cancellazione.
      fs.writeFileSync(typesPath, before)
    } catch {
      // Il ripristino non deve mascherare l'esito del controllo.
    }
  }
  const onSignal = () => {
    restore()
    process.exit(130)
  }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  let res
  let generatedContent
  try {
    fs.writeFileSync(typesPath, `${before}${before.endsWith('\n') ? '' : '\n'}${sentinel}\n`)
    res = spawnSync(bin, ['generate:types'], { cwd: cmsDir, encoding: 'utf8' })
    generatedContent = fs.existsSync(typesPath) ? fs.readFileSync(typesPath, 'utf8') : ''
  } finally {
    process.removeListener('SIGINT', onSignal)
    process.removeListener('SIGTERM', onSignal)
    restore()
  }

  const wroteCanonical = !generatedContent.includes(sentinel)
  // `after` e' quello che lo schema produce (sentinella tolta dal generatore): se differisce
  // dal file committato, i tipi sono fermi.
  const after = generatedContent
  const statusAfter = repositoryStatus()
  // Stato git non leggibile = albero non osservabile: si segnala, non si finge pulito.
  const dirty =
    statusAfter === null || statusBefore === null
      ? 'stato git non leggibile'
      : statusAfter === statusBefore
        ? false
        : changedLines(statusBefore, statusAfter) || 'cambiamento non dettagliabile'
  return {
    generated: res.status === 0 ? 'done' : 'failed',
    before,
    after,
    dirty,
    wroteCanonical,
    spawnFailed: res.error != null,
  }
}

/** Le righe di stato comparse o sparite fra i due rilievi (per una diagnosi leggibile). */
function changedLines(before, after) {
  const beforeLines = new Set(before.split('\n').filter(Boolean))
  const afterLines = new Set(after.split('\n').filter(Boolean))
  const appeared = [...afterLines].filter((line) => !beforeLines.has(line))
  const vanished = [...beforeLines].filter((line) => !afterLines.has(line))
  return [...appeared, ...vanished.map((line) => `-${line}`)].slice(0, 3).join(' | ')
}

function checkGeneratedTypes() {
  const run = regenerateTypes()
  const changed = run.generated === 'unavailable' ? changedFiles() : []
  return evaluateGeneratedTypes({ ...run, changed })
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
    .filter((rel) => {
      // `git ls-files` elenca anche i symlink: uno che punta a una directory farebbe
      // esplodere la lettura con EISDIR (falso rosso su una base di diff non risolvibile).
      try {
        return fs.statSync(path.join(repoRoot, rel)).isFile()
      } catch {
        return false
      }
    })
    .filter((rel) => !/\.(png|jpg|jpeg|webp|gif|ico|woff2?|ttf|otf|pdf)$/i.test(rel))
    .filter((rel) => !/package-lock\.json$/.test(rel))
    .map((rel) => ({ path: rel, content: read(rel) }))
  const findings = scanForSecrets(files)
  return findings.length === 0 ? true : findings.join(' | ')
}

function checkLockfiles() {
  if (inCi) return { skip: 'in CI i lockfile li prova `npm ci --ignore-scripts`' }
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
    runCheck('riordino: metadata monetari con la funzione condivisa', checkMoneyMetadataWriters),
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
    if (skipped.length) {
      console.log(`  (${skipped.length} controlli saltati: ${skipped.map((c) => `${c.name} - ${c.skip}`).join('; ')})`)
    }
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
