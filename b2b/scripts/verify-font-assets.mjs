#!/usr/bin/env node
/**
 * Verifica ripetibile del self-host dei font B2B.
 *
 * Esce 1 se uno dei controlli fallisce, 0 se sono tutti verdi.
 * Ogni messaggio di errore nomina il file colpevole.
 *
 * Uso: npm run verify:fonts   (da b2b/)
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const B2B_ROOT = path.resolve(__dirname, '..')

/* ------------------------------------------------------------------ */
/* Dati pinnati (non rigenerare a mano: sono l'impronta della baseline) */
/* ------------------------------------------------------------------ */

const EXPECTED_FINGERPRINT =
  'af0caa90e5c4050023566910f9e8876ff8d0a2c136c242e10fe9c259c55df4a1'

const EXPECTED_FACE_COUNT = 34

// Nome file -> sha256 atteso. Byte-identici ai sorgenti della build baseline.
const FONT_SHA256 = new Map([
  ['01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2', '5d618c462b7a5b74f442e1548880086af71764d9cc7d35c16ab45353da934621'],
  ['0926c12c4384550f-s.1-qpv3jvnkkyl.woff2', '06bc9a8c179afaf7dd5d3b4987ad2f4a82ca85a542c9e498b18bf32ad0257d8e'],
  ['1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2', '92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12'],
  ['1f9e983605289f29-s.3aak_kra40y8r.woff2', '9dc38267bdee93a653200ef3c1e8060e3f1399073432c415c683b419d3b50464'],
  ['591574edbe85c69b-s.2cu8l7zf4s4ec.woff2', '3170a883f1968a2d1135259e40fd88508da70c20337e491f171f9405d0749053'],
  ['8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2', 'e6d6d1d73858aa9b66f3a3539f9dec22faab2276e61ad1d813bc04dd59c9c122'],
  ['9cc5c0547f229dea-s.00y8kskkn0hyx.woff2', 'd04439363ec805132dc6c6e6a925f76efe17646f9811af8e10e218ea3dba5335'],
  ['acf349172f10b359-s.0gv8q2vqi14yg.woff2', '3512ad3b4ddd21fa75ab44296867da1f82948350ffba678a04afbb511015cb08'],
  ['b0947914c9718a1e-s.1xjn85gt7t6qs.woff2', 'd81372bae1f872f1418c0b7eb412f8a92a156a950fda8d2383701c75d38969df'],
  ['b2ea385cb5ae8625-s.1spbknb88wd48.woff2', '9e38b3f1575daba3435ef09d33a202585ed5bd204bd0a8c744955c750c2b9091'],
  ['d0b60be57f16ee32-s.1xtu7gopqv2u0.woff2', '826f73ca737feec0eb1004808629973d6b611fddc2bd2a689b5fe331f6be6427'],
  ['d8cddd76dbfeaef0-s.1mblz1wog092a.woff2', '919a7720ae1671f06ebdd4f65bb9c2f0d619f81f805d85aec025c89139536292'],
])

const FORBIDDEN_TOKENS = [
  'next/font/google',
  'next/font/local',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]

const PUBLIC_FONTS_DIR = path.join(B2B_ROOT, 'public', 'fonts')
const GOOGLE_FONTS_DIR = path.join(PUBLIC_FONTS_DIR, 'google')
const GOOGLE_FONTS_CSS = path.join(B2B_ROOT, 'src', 'app', 'google-fonts.css')

const OFL_FILES = [
  path.join(PUBLIC_FONTS_DIR, 'OFL-Outfit.txt'),
  path.join(PUBLIC_FONTS_DIR, 'OFL-Cormorant-Garamond.txt'),
]

/* ------------------------------------------------------------------ */
/* Utility                                                             */
/* ------------------------------------------------------------------ */

const failures = []
let checks = 0

function rel(p) {
  return path.relative(B2B_ROOT, p).split(path.sep).join('/')
}

function pass(label, detail = '') {
  checks++
  console.log(`PASS ${label}${detail ? ` — ${detail}` : ''}`)
}

function fail(label, detail) {
  checks++
  failures.push(`${label}: ${detail}`)
  console.log(`FAIL ${label} — ${detail}`)
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      out.push(...walkFiles(full))
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
  return out
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/**
 * Estrae i blocchi @font-face in ordine di documento, con brace matching
 * (niente regex fragili: i blocchi non sono annidati).
 */
function extractFontFaces(text) {
  const faces = []
  let i = 0
  while (i < text.length) {
    const idx = text.indexOf('@font-face', i)
    if (idx === -1) break
    const open = text.indexOf('{', idx)
    if (open === -1) break
    let depth = 0
    let j = open
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) {
          j++
          break
        }
      }
    }
    faces.push(text.slice(idx, j))
    i = j
  }
  return faces
}

function parseDeclarations(block) {
  const body = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'))
  const out = new Map()
  for (const part of body.split(';')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const key = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    if (key) out.set(key, value)
  }
  return out
}

function isLocalSrc(src) {
  return /^local\(/i.test(src.trim())
}

function urlOf(src) {
  const m = src.match(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^)'"]+))\s*\)/)
  if (!m) return null
  return (m[1] ?? m[2] ?? m[3]).trim()
}

function fileNameOf(src) {
  const url = urlOf(src)
  if (!url) return null
  return url.split('/').pop()
}

/** Riga di impronta: family|style|weight|display|NOMEFILE|unicode-range */
function faceFingerprintLine(block) {
  const d = parseDeclarations(block)
  const family = d.get('font-family') ?? ''
  const style = d.get('font-style') ?? '-'
  const weight = d.get('font-weight') ?? '-'
  const display = d.get('font-display') ?? '-'
  const src = d.get('src') ?? ''
  const range = d.get('unicode-range') ?? '-'
  const srcField = isLocalSrc(src) ? src : (fileNameOf(src) ?? src)
  return [family, style, weight, display, srcField, range].join('|')
}

function fingerprintOf(faces) {
  const text = faces.map(faceFingerprintLine).join('\n')
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

/* ------------------------------------------------------------------ */
/* a. nessun riferimento a next/font o ai CDN Google nei sorgenti       */
/* ------------------------------------------------------------------ */

function checkNoGoogleFontReferences() {
  const label = 'a. sorgenti senza next/font / CDN Google'
  const scopes = [path.join(B2B_ROOT, 'src')]

  for (const name of fs.readdirSync(B2B_ROOT)) {
    if (/^next\.config\./.test(name) || /^postcss\.config\./.test(name)) {
      scopes.push(path.join(B2B_ROOT, name))
    }
  }

  const hits = []
  for (const scope of scopes) {
    const files = fs.statSync(scope).isDirectory() ? walkFiles(scope) : [scope]
    for (const file of files) {
      let text
      try {
        text = fs.readFileSync(file, 'utf8')
      } catch {
        continue
      }
      const lines = text.split('\n')
      for (const token of FORBIDDEN_TOKENS) {
        lines.forEach((line, index) => {
          if (line.includes(token)) {
            hits.push(`${rel(file)}:${index + 1} contiene "${token}"`)
          }
        })
      }
    }
  }

  if (hits.length > 0) {
    for (const hit of hits) console.log(`     ${hit}`)
    fail(label, `${hits.length} occorrenze vietate`)
    return
  }
  pass(label, `${scopes.length} scope scansionati`)
}

/* ------------------------------------------------------------------ */
/* b. i 12 woff2 esistono con gli sha256 pinnati                       */
/* ------------------------------------------------------------------ */

function checkFontBinaries() {
  const label = 'b. 12 woff2 con sha256 pinnato'
  const problems = []
  let ok = 0

  for (const [name, expected] of FONT_SHA256) {
    const file = path.join(GOOGLE_FONTS_DIR, name)
    if (!fs.existsSync(file)) {
      problems.push(`${rel(file)} mancante`)
      continue
    }
    const actual = sha256File(file)
    if (actual !== expected) {
      problems.push(`${rel(file)} sha256 ${actual} != atteso ${expected}`)
      continue
    }
    ok++
  }

  if (problems.length > 0) {
    for (const p of problems) console.log(`     ${p}`)
    fail(label, `${ok}/${FONT_SHA256.size} file corretti`)
    return
  }
  pass(label, `${ok}/${FONT_SHA256.size} file corretti`)
}

/* ------------------------------------------------------------------ */
/* c. google-fonts.css: 34 facce, src /fonts/google, impronta attesa   */
/* ------------------------------------------------------------------ */

function validateFacesCss(faces, label) {
  if (faces.length !== EXPECTED_FACE_COUNT) {
    fail(label, `${faces.length} facce invece di ${EXPECTED_FACE_COUNT}`)
    return false
  }

  const problems = []
  let localCount = 0

  faces.forEach((block, index) => {
    const d = parseDeclarations(block)
    const src = d.get('src')
    if (!src) {
      problems.push(`faccia #${index + 1} senza src`)
      return
    }
    if (isLocalSrc(src)) {
      // Le facce fallback usano local(...): nessun file da verificare.
      localCount++
      return
    }
    const url = urlOf(src)
    if (!url || !url.startsWith('/fonts/google/')) {
      problems.push(`faccia #${index + 1} (${d.get('font-family') ?? '?'}) src non punta a /fonts/google/: ${src}`)
      return
    }
    const name = url.split('/').pop()
    if (!FONT_SHA256.has(name)) {
      problems.push(`faccia #${index + 1} cita file non pinnato: ${name}`)
      return
    }
    const file = path.join(GOOGLE_FONTS_DIR, name)
    if (!fs.existsSync(file)) {
      problems.push(`faccia #${index + 1} cita ${name} che non esiste in public/fonts/google/`)
    }
  })

  if (problems.length > 0) {
    for (const p of problems) console.log(`     ${p}`)
    fail(label, `${problems.length} problemi`)
    return false
  }

  const fingerprint = fingerprintOf(faces)
  if (fingerprint !== EXPECTED_FINGERPRINT) {
    fail(label, `impronta ${fingerprint} != attesa ${EXPECTED_FINGERPRINT}`)
    return false
  }

  pass(label, `${faces.length} facce (${localCount} local fallback), impronta ${fingerprint}`)
  return true
}

function checkGoogleFontsCss() {
  const label = 'c. src/app/google-fonts.css'
  if (!fs.existsSync(GOOGLE_FONTS_CSS)) {
    fail(label, `${rel(GOOGLE_FONTS_CSS)} mancante`)
    return
  }
  const css = fs.readFileSync(GOOGLE_FONTS_CSS, 'utf8')
  validateFacesCss(extractFontFaces(css), label)
}

/* ------------------------------------------------------------------ */
/* d. le due licenze OFL esistono e contengono il testo atteso         */
/* ------------------------------------------------------------------ */

function checkLicenses() {
  const label = 'd. licenze OFL'
  const problems = []
  for (const file of OFL_FILES) {
    if (!fs.existsSync(file)) {
      problems.push(`${rel(file)} mancante`)
      continue
    }
    if (!fs.readFileSync(file, 'utf8').includes('SIL OPEN FONT LICENSE')) {
      problems.push(`${rel(file)} non contiene "SIL OPEN FONT LICENSE"`)
    }
  }

  if (problems.length > 0) {
    for (const p of problems) console.log(`     ${p}`)
    fail(label, `${problems.length} problemi`)
    return
  }
  pass(label, `${OFL_FILES.length} file con "SIL OPEN FONT LICENSE"`)
}

/* ------------------------------------------------------------------ */
/* e. parita' col CSS compilato (se la build esiste)                   */
/* ------------------------------------------------------------------ */

function collectBuiltCss() {
  const roots = [
    path.join(B2B_ROOT, '.next', 'static', 'css'),
    path.join(B2B_ROOT, '.next', 'static', 'chunks'),
  ]
  const files = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const file of walkFiles(root)) {
      if (file.endsWith('.css')) files.push(file)
    }
  }
  files.sort()
  return files
}

function checkCompiledParity() {
  const label = 'e. parita\' con il CSS compilato'
  const files = collectBuiltCss()

  if (files.length === 0) {
    pass(label, 'nessun output di build presente (controllo saltato)')
    return
  }

  const css = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const faces = extractFontFaces(css)

  if (faces.length === 0) {
    fail(label, `output di build presente (${files.length} file CSS) ma nessuna faccia @font-face`)
    return
  }

  if (faces.length !== EXPECTED_FACE_COUNT) {
    fail(label, `${faces.length} facce nel CSS compilato invece di ${EXPECTED_FACE_COUNT}`)
    return
  }

  const fingerprint = fingerprintOf(faces)
  if (fingerprint !== EXPECTED_FINGERPRINT) {
    fail(label, `impronta compilata ${fingerprint} != attesa ${EXPECTED_FINGERPRINT}`)
    return
  }

  pass(label, `${faces.length} facce in ${files.length} file CSS, impronta ${fingerprint}`)
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

console.log('Verifica font self-host B2B')
console.log(`Root: ${B2B_ROOT}`)
console.log('')

checkNoGoogleFontReferences()
checkFontBinaries()
checkGoogleFontsCss()
checkLicenses()
checkCompiledParity()

console.log('')
if (failures.length === 0) {
  console.log(`RIEPILOGO: ${checks} controlli, tutti PASS — font self-host OK`)
  process.exit(0)
}

console.log(`RIEPILOGO: ${checks} controlli, ${failures.length} FAIL`)
for (const failure of failures) console.log(`  - ${failure}`)
process.exit(1)
