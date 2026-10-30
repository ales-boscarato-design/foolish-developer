import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Il mondo SEBO e' stato smontato dal sito il 30/10/2026: `/{lingua}/sebo` risponde 301 verso
 * `/{lingua}/laboratorio`, il laboratorio del Pellaio e' l'unico ingresso, e i testi della
 * vecchia pagina non devono tornare visitabili in nessuna forma.
 *
 * Questi test sono il guardiano di quella decisione: falliscono se qualcuno reintroduce una
 * chiave `sebo.*`, un link a `/sebo`, la pagina vecchia, o un redirect che non sia 301.
 */

type Lang = 'it' | 'en' | 'fr' | 'es' | 'de'

const LANGS: Lang[] = ['it', 'en', 'fr', 'es', 'de']

/** Le etichette di menu decise da Alessandro: una sola voce, coerente nelle cinque lingue. */
const LABORATORIO_LABELS: Record<Lang, string> = {
  it: 'Laboratorio',
  en: 'Laboratory',
  fr: 'Laboratoire',
  es: 'Laboratorio',
  de: 'Werkstatt',
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

type Tree = Record<string, unknown>

const messagesTree = (lang: Lang): Tree => JSON.parse(read(`../../messages/${lang}.json`)) as Tree

/** Percorsi delle chiavi foglia: stessa regola del gate pre-deploy. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Tree).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k))
}

/** Ogni file `.ts`/`.tsx` del prodotto sotto `src/`, esclusi i test stessi. */
function productSources(): { rel: string; source: string }[] {
  const root = new URL('../', import.meta.url)
  const out: { rel: string; source: string }[] = []
  const walk = (dir: URL, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) {
        walk(child, childRel)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      out.push({ rel: childRel, source: readFileSync(child, 'utf8') })
    }
  }
  walk(root, '')
  return out
}

// ── Chiavi i18n ─────────────────────────────────────────────────────────────────────────

test('nessuna chiave sebo.* sopravvive nei cinque file messages', () => {
  for (const lang of LANGS) {
    const keys = leafKeys(messagesTree(lang))
    const survivors = keys.filter((k) => k.split('.').includes('sebo'))
    assert.deepEqual(survivors, [], `${lang}: chiavi sebo.* ancora presenti`)
  }
})

test('le chiavi i18n restano in parita` fra le cinque lingue', () => {
  const reference = leafKeys(messagesTree('it')).sort()
  for (const lang of LANGS) {
    const keys = leafKeys(messagesTree(lang)).sort()
    assert.deepEqual(
      { missing: reference.filter((k) => !keys.includes(k)), extra: keys.filter((k) => !reference.includes(k)) },
      { missing: [], extra: [] },
      `${lang}: le chiavi non combaciano con l'italiano`,
    )
  }
})

test('la voce di menu e` una sola, "Laboratorio", con l`etichetta decisa per lingua', () => {
  for (const lang of LANGS) {
    const nav = messagesTree(lang).nav as Tree
    assert.equal(nav.laboratorio, LABORATORIO_LABELS[lang], `${lang}: etichetta di menu sbagliata`)
    assert.ok(!('sebo' in nav), `${lang}: nav.sebo esiste ancora`)
  }
})

// ── Navigazione e link interni ──────────────────────────────────────────────────────────

test('la nav ha una sola voce "Laboratorio" e nessun link a /sebo', () => {
  const navSource = read('../components/Nav.tsx')
  assert.ok(!navSource.includes("'/sebo'"), 'la nav punta ancora a /sebo')
  const laboratorioLinks = navSource.match(/'\/laboratorio'/g) ?? []
  assert.equal(laboratorioLinks.length, 1, 'la voce /laboratorio deve comparire una volta sola')
  assert.ok(navSource.includes("labelKey: 'laboratorio'"), 'la voce deve usare l`etichetta laboratorio')
})

test('nessun sorgente del prodotto rimanda a /sebo (pagina o asset)', () => {
  const offenders = productSources()
    .filter(({ source }) => /\/sebo\b/i.test(source))
    .map(({ rel }) => rel)
  assert.deepEqual(offenders, [], `sorgenti che nominano ancora /sebo: ${offenders.join(', ')}`)
})

test('la pagina /sebo e i suoi dati non esistono piu` nel repo', () => {
  assert.equal(existsSync(new URL('../app/[locale]/sebo', import.meta.url)), false, 'route /sebo ancora presente')
  assert.equal(existsSync(new URL('../data/sebo-wall.json', import.meta.url)), false, 'dati del muro SEBO ancora presenti')
})

// ── Redirect permanente ────────────────────────────────────────────────────────────────

test('next.config dichiara un 301 esplicito per lingua, non un redirect generico', () => {
  const config = read('../../next.config.ts')
  const start = config.indexOf('const seboRedirects')
  assert.ok(start >= 0, 'manca il blocco seboRedirects')
  const block = config.slice(start, config.indexOf('}))', start) + 3)
  assert.ok(block.includes('source: `/${locale}/sebo`'), 'il redirect deve partire da /{lingua}/sebo')
  assert.ok(
    block.includes('destination: `/${locale}/laboratorio`'),
    'il redirect deve arrivare a /{lingua}/laboratorio',
  )
  assert.ok(block.includes('statusCode: 301'), 'lo status deve essere 301 (con `permanent: true` Next servirebbe 308)')
  assert.ok(!block.includes('permanent: true'), 'nessuna scorciatoia `permanent`, che produrrebbe un 308')
  assert.ok(!block.includes(':path*'), 'nessun pattern generico: mappa esplicita per lingua')
  assert.ok(config.includes('...seboRedirects'), 'il blocco non e` agganciato a redirects()')
  // Le cinque lingue sono quelle del routing: se cambiano, il redirect deve seguirle.
  assert.match(config, /const LOCALES = \['it', 'en', 'fr', 'es', 'de'\]/)
})

// ── sitemap ────────────────────────────────────────────────────────────────────────────

test('la sitemap pubblica /laboratorio e non /sebo', () => {
  const sitemap = read('../app/sitemap.ts')
  const start = sitemap.indexOf('const STATIC_ROUTES')
  assert.ok(start >= 0, 'manca STATIC_ROUTES')
  const block = sitemap.slice(start, sitemap.indexOf(']', start) + 1)
  assert.ok(block.includes("'/laboratorio'"), 'STATIC_ROUTES deve contenere /laboratorio')
  assert.ok(!block.includes("'/sebo'"), 'STATIC_ROUTES non deve contenere /sebo')
})
