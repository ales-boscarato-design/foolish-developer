#!/usr/bin/env node
/**
 * Crea (o aggiorna) un affiliato e il suo codice sconto personale, poi stampa
 * il link di referral e il link privato alle statistiche.
 *
 * Idempotente: rilanciarlo sullo stesso slug aggiorna la configurazione invece
 * di duplicarla. Non stampa mai credenziali o segreti.
 *
 * Uso:
 *   node scripts/create-affiliate.mjs --name "Néstor" --slug nestor --code NESTOR15 \
 *     --email nestor@example.com --percent 15 --step-percent 3 \
 *     --threshold-euro 500 --max-percent 38
 *
 * Credenziali: variabili d'ambiente, oppure un file locale (permessi 600):
 *   ~/.hermes/secrets/foolish-cms.env  con
 *     PAYLOAD_PUBLIC_URL=https://cms-production-1e56.up.railway.app
 *     CMS_API_KEY=...              # preferito: nel CMS, Utenti -> API key
 *     # oppure, in alternativa, le credenziali admin:
 *     CMS_ADMIN_EMAIL=...
 *     CMS_ADMIN_PASSWORD=...
 *     AFFILIATE_STATS_SECRET=...      # segreto dedicato al link statistiche (obbligatorio per generarlo;
 *                                     # deve avere lo stesso valore configurato sullo storefront)
 *     STOREFRONT_URL=https://thefoolishbutcher.com
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SECRETS_FILE = path.join(os.homedir(), '.hermes', 'secrets', 'foolish-cms.env')

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const values = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue
    const key = trimmed.slice(0, separator).trim()
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, '')
    values[key] = value
  }
  return values
}

const fileEnv = loadEnvFile(SECRETS_FILE)
const config = {
  cmsUrl: (process.env.PAYLOAD_PUBLIC_URL || fileEnv.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app').replace(/\/+$/, ''),
  storefrontUrl: (process.env.STOREFRONT_URL || fileEnv.STOREFRONT_URL || 'https://thefoolishbutcher.com').replace(/\/+$/, ''),
  email: process.env.CMS_ADMIN_EMAIL || fileEnv.CMS_ADMIN_EMAIL || '',
  password: process.env.CMS_ADMIN_PASSWORD || fileEnv.CMS_ADMIN_PASSWORD || '',
  // Preferita quando c'e': l'API key di un utente CMS evita di custodire la
  // password di un amministratore ed e' revocabile dal CMS.
  apiKey: process.env.CMS_API_KEY || fileEnv.CMS_API_KEY || '',
  // Segreto dedicato: deve essere lo stesso configurato sullo storefront. Non si
  // riusa PAYLOAD_API_SECRET, così un leak di quel segreto non permette di firmare
  // i link statistiche di tutti gli affiliati.
  statsSecret: process.env.AFFILIATE_STATS_SECRET || fileEnv.AFFILIATE_STATS_SECRET || '',
}

function parseArguments(argv) {
  const options = {
    name: '',
    slug: '',
    code: '',
    contactEmail: '',
    percent: 15,
    stepPercent: 3,
    thresholdEuro: 500,
    maxPercent: 38,
    cookieDays: 30,
    locale: 'it',
    status: 'active',
  }
  const mapping = {
    '--name': 'name',
    '--slug': 'slug',
    '--code': 'code',
    '--email': 'contactEmail',
    '--percent': 'percent',
    '--step-percent': 'stepPercent',
    '--threshold-euro': 'thresholdEuro',
    '--max-percent': 'maxPercent',
    '--cookie-days': 'cookieDays',
    '--locale': 'locale',
    '--status': 'status',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const key = mapping[argv[index]]
    if (!key) throw new Error(`Argomento non riconosciuto: ${argv[index]}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`Valore mancante per ${argv[index]}`)
    options[key] = ['percent', 'stepPercent', 'thresholdEuro', 'maxPercent', 'cookieDays'].includes(key)
      ? Number(value)
      : value
    index += 1
  }

  if (options.name === '' || options.slug === '' || options.code === '') {
    throw new Error('Servono --name, --slug e --code')
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(options.slug)) {
    throw new Error('Lo slug deve contenere solo minuscole, numeri e trattini (1-63 caratteri)')
  }
  const code = options.code.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(code)) {
    throw new Error('Il codice deve iniziare con lettera o numero e usare solo A-Z, 0-9, _ e -')
  }
  options.code = code
  for (const key of ['percent', 'stepPercent', 'thresholdEuro', 'maxPercent', 'cookieDays']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error(`Valore non valido per ${key}`)
  }
  if (options.percent <= 0 || options.percent > 100) throw new Error('La percentuale di sconto deve essere tra 1 e 100')
  return options
}

/**
 * Autenticazione accettata da Payload: l'API key di un utente, oppure il
 * token di una sessione admin. Qualsiasi altra forma non viene inviata.
 */
function authHeader(auth) {
  if (!auth || typeof auth.value !== 'string' || auth.value === '') return {}
  if (auth.kind === 'apiKey') return { Authorization: `users API-Key ${auth.value}` }
  if (auth.kind === 'session') return { Authorization: `JWT ${auth.value}` }
  return {}
}

async function api(token, method, route, body) {
  const response = await fetch(`${config.cmsUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(token),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    parsed = null
  }
  if (!response.ok) {
    const message = parsed?.errors?.[0]?.message || parsed?.message || `HTTP ${response.status}`
    throw new Error(`${method} ${route} → ${message}`)
  }
  return parsed
}

async function login() {
  if (config.apiKey !== '') return { kind: 'apiKey', value: config.apiKey }
  if (config.email === '' || config.password === '') {
    throw new Error(
      `Credenziali CMS mancanti. Crea ${SECRETS_FILE} (permessi 600) con CMS_API_KEY, oppure con CMS_ADMIN_EMAIL e CMS_ADMIN_PASSWORD.`,
    )
  }
  const result = await api(null, 'POST', '/api/users/login', {
    email: config.email,
    password: config.password,
  })
  if (typeof result?.token !== 'string' || result.token === '') throw new Error('Login senza token')
  return { kind: 'session', value: result.token }
}

function statsToken(slug) {
  if (config.statsSecret === '') return null
  return crypto.createHmac('sha256', config.statsSecret).update(`affiliate-stats:${slug}`).digest('hex').slice(0, 32)
}

async function upsertPromoCode(token, options) {
  const existing = await api(
    token,
    'GET',
    `/api/promo-codes?where[code][equals]=${encodeURIComponent(options.code)}&limit=1&depth=0`,
  )
  const payload = {
    code: options.code,
    type: 'percent',
    discountPercent: options.percent,
    active: true,
  }

  const doc = existing?.docs?.[0]
  if (doc?.id) {
    await api(token, 'PATCH', `/api/promo-codes/${doc.id}`, payload)
    return { id: doc.id, created: false }
  }
  const created = await api(token, 'POST', '/api/promo-codes', payload)
  return { id: created.doc.id, created: true }
}

async function upsertAffiliate(token, options, promoCodeId) {
  const existing = await api(
    token,
    'GET',
    `/api/affiliates?where[slug][equals]=${encodeURIComponent(options.slug)}&limit=1&depth=0`,
  )
  const payload = {
    name: options.name,
    slug: options.slug,
    status: options.status,
    promoCode: promoCodeId,
    commissionBaseRateBps: Math.round(options.percent * 100),
    commissionStepRateBps: Math.round(options.stepPercent * 100),
    commissionStepThresholdCents: Math.round(options.thresholdEuro * 100),
    commissionMaxRateBps: Math.round(options.maxPercent * 100),
    cookieWindowDays: options.cookieDays,
    ...(options.contactEmail === '' ? {} : { contactEmail: options.contactEmail }),
  }

  const doc = existing?.docs?.[0]
  if (doc?.id) {
    const updated = await api(token, 'PATCH', `/api/affiliates/${doc.id}`, payload)
    return { id: doc.id, created: false, status: updated?.doc?.status }
  }
  const created = await api(token, 'POST', '/api/affiliates', payload)
  return { id: created.doc.id, created: true, status: created?.doc?.status }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const token = await login()

  const promo = await upsertPromoCode(token, options)
  const affiliate = await upsertAffiliate(token, options, promo.id)

  const referralLink = `${config.storefrontUrl}/${options.locale}/a/${options.slug}`
  const token32 = statsToken(options.slug)
  const statsLink = token32 === null ? null : `${config.storefrontUrl}/${options.locale}/a/${options.slug}/stats?token=${token32}`

  console.log(JSON.stringify({
    ok: true,
    cms: config.cmsUrl,
    affiliate: {
      id: affiliate.id,
      slug: options.slug,
      created: affiliate.created,
      status: options.status,
      promoCode: options.code,
      promoCodeCreated: promo.created,
      commission: {
        basePercent: options.percent,
        stepPercent: options.stepPercent,
        stepThresholdEuro: options.thresholdEuro,
        maxPercent: options.maxPercent,
        cookieDays: options.cookieDays,
      },
    },
    referralLink,
    statsLink,
    statsLinkNote: statsLink === null
      ? 'AFFILIATE_STATS_SECRET non disponibile: link statistiche non generato. Impostalo qui e sullo storefront (deve essere lo stesso valore).'
      : 'Link privato: chiunque lo abbia vede i numeri di questo affiliato. Non pubblicarlo.',
  }, null, 2))
}

main().catch((error) => {
  console.error(`Errore: ${error.message}`)
  process.exitCode = 1
})
