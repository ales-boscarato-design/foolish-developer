import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PARADOX_IDS, STAFF_IDS, TELEGRAM_BOT_URL, buildStaffItems, practiceSkinHref } from './laboratorio'

/**
 * La pagina `/laboratorio` e' fatta di testi approvati da Alessandro il 30/10/2026 e non
 * riscritti. Questi test congelano quel testo: il file di fixture e' la copia byte per byte
 * del documento approvato (`sha256 76dcab53…`), e ogni valore mostrato dalla pagina deve
 * ricomporre il blocco corrispondente, lingua per lingua.
 */

type Lang = 'it' | 'en' | 'fr' | 'es' | 'de'

const LANGS: Lang[] = ['it', 'en', 'fr', 'es', 'de']
const COMPACT: Record<Lang, boolean> = { it: false, en: false, fr: true, es: true, de: true }

type Tree = Record<string, unknown>

const readJson = (abs: URL) => JSON.parse(readFileSync(abs, 'utf8')) as Tree
const messages = (lang: Lang): Tree => readJson(new URL(`../../messages/${lang}.json`, import.meta.url))
const laboratorio = (lang: Lang): Tree => messages(lang).laboratorio as Tree
const pageSource = readFileSync(new URL('../app/[locale]/laboratorio/page.tsx', import.meta.url), 'utf8')
const boardSource = readFileSync(new URL('../components/laboratorio/StaffBoard.tsx', import.meta.url), 'utf8')

/** Percorsi delle chiavi foglia: e' la stessa regola del gate pre-deploy. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Tree).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k))
}

function leafValues(value: unknown): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [String(value)]
  return Object.values(value as Tree).flatMap(leafValues)
}

// ── Testi approvati: parsing del documento di fixture ────────────────────────────────────

const APPROVED = readFileSync(new URL('./__fixtures__/laboratorio-testi-approvati.md', import.meta.url), 'utf8')

function normalize(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\\/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function langChunks(raw: string): Record<Lang, string> {
  const names: Record<string, Lang> = { ENGLISH: 'en', FRANÇAIS: 'fr', ESPAÑOL: 'es', DEUTSCH: 'de' }
  const parts = raw.split(/^# (ENGLISH|FRANÇAIS|ESPAÑOL|DEUTSCH)\s*$/m)
  const out: Record<string, string> = { it: parts[0] }
  for (let i = 1; i < parts.length; i += 2) out[names[parts[i]]] = parts[i + 1]
  return out as Record<Lang, string>
}

function sectionsOf(chunk: string, compact: boolean): Record<number, string> {
  const collected: Record<number, string[]> = {}
  let current: number | null = null
  for (const line of chunk.split('\n')) {
    if (compact) {
      const head = /^\*\*(\d)\.\s*[^*]*\*\*\s*(?:—\s*)?(.*)$/.exec(line)
      if (head) {
        current = Number(head[1])
        collected[current] = [head[2]]
        continue
      }
      if (current !== null && line.trim() && line.trim() !== '---') {
        collected[current].push(line.trim())
      }
      continue
    }
    const head = /^## (\d)\.\s*(.*)$/.exec(line)
    if (head) {
      current = Number(head[1])
      collected[current] = []
      continue
    }
    if (current !== null && /^#{1,2} /.test(line)) {
      current = null
      continue
    }
    if (current !== null && !line.startsWith('---')) collected[current].push(line)
  }
  const out: Record<number, string> = {}
  for (const [k, lines] of Object.entries(collected)) out[Number(k)] = normalize(lines.join('\n'))
  return out
}

const CHUNKS = langChunks(APPROVED)
const BLOCK = (lang: Lang, n: number) => sectionsOf(CHUNKS[lang], COMPACT[lang])[n]

const str = (value: unknown): string => {
  assert.equal(typeof value, 'string')
  return value as string
}

const EYEBROW = 'FOOLISH LAB · CHIERI (TO)'
const HERO_NAME: Record<Lang, string> = {
  it: 'Il Pellaio.',
  en: 'The Tanner.',
  fr: 'Le Peaussier.',
  es: 'El Pellejero.',
  de: 'Der Häuter.',
}

function heroExpected(lang: Lang): [string, string, string] {
  const block = BLOCK(lang, 1)
  if (COMPACT[lang]) {
    assert.ok(block.startsWith(`${EYEBROW} `), `${lang}: hero senza eyebrow`)
    const rest = block.slice(EYEBROW.length + 1)
    const cut = rest.indexOf(HERO_NAME[lang])
    assert.ok(cut > 0, `${lang}: sottotitolo dell hero non riconosciuto`)
    return [EYEBROW, rest.slice(0, cut).trim(), rest.slice(cut)]
  }
  const parsed = /^eyebrow — (.*?) H1 — (.*?) sub — (.*?)(?: alt immagine — .*)?$/.exec(block)
  assert.ok(parsed, `${lang}: hero non riconosciuto nel documento approvato`)
  return [parsed![1], parsed![2], parsed![3]]
}

function staffBlock(lang: Lang): string {
  const staff = laboratorio(lang).staff as Tree
  const items = staff.items as Record<string, Tree>
  const rendered = STAFF_IDS.map((id) => {
    const item = items[id]
    const trait = str(item.trait)
    const aside = str(item.aside)
    const core = trait ? `${str(item.role)} — ${trait} > ${str(item.quote)}` : `${str(item.role)} — ${str(item.quote)}`
    return aside ? `${core} ${aside}` : core
  })
  return `${str(staff.intro)} ${rendered.join(' ')}`
}

// ── Test ────────────────────────────────────────────────────────────────────────────────

test('parita` delle chiavi i18n: il namespace laboratorio ha lo stesso set nelle 5 lingue', () => {
  const sets = Object.fromEntries(LANGS.map((l) => [l, new Set(leafKeys(laboratorio(l)))])) as Record<Lang, Set<string>>
  const reference = sets.it
  for (const lang of LANGS) {
    const missing = [...reference].filter((k) => !sets[lang].has(k))
    const extra = [...sets[lang]].filter((k) => !reference.has(k))
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${lang}: chiavi divergenti`)
  }
})

test('testi approvati: ogni blocco della pagina ricompone il documento, per tutte e 5 le lingue', () => {
  for (const lang of LANGS) {
    const lab = laboratorio(lang)
    const hero = lab.hero as Tree
    const intro = lab.intro as Tree
    const scale = lab.scale as Tree
    const labSection = lab.lab as Tree
    const paradox = lab.paradox as Tree
    const series = lab.series as Tree
    const episode = series.episode as Tree
    const cta = lab.cta as Tree

    const [eyebrow, title, sub] = heroExpected(lang)
    assert.deepEqual(
      [str(hero.eyebrow), str(hero.title), str(hero.sub)],
      [eyebrow, title, sub],
      `${lang}: hero diverso dal testo approvato`,
    )

    const expected: Record<number, string> = {
      2: [intro.p1, intro.p2, intro.p3, intro.p4].map(str).join(' '),
      3: [scale.p1, scale.p2, scale.p3, scale.p4].map(str).join(' '),
      4: staffBlock(lang),
      5: [labSection.p1, labSection.p2, labSection.p3].map(str).join(' '),
      6: [paradox.intro, ...PARADOX_IDS.map((id) => paradox[id]), paradox.closing].map(str).join(' '),
      7:
        lang === 'it'
          ? `${str(series.p1)} ${str(series.p2)} ${str(episode.code)} — ${str(episode.title)}. ${str(episode.body)}`
          : `${str(series.p1)} ${str(series.p2)}`,
      8: `${str(cta.title)} → [${str(cta.practiceSkin)}](${practiceSkinHref(lang)}) · [${str(cta.bot)}](${TELEGRAM_BOT_URL})`,
    }

    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const approved = BLOCK(lang, n).replace(/ - /g, ' ')
      assert.equal(expected[n], approved, `${lang}: blocco ${n} non coincide con il testo approvato`)
    }
  }
})

test('episodio 003: etichetta di struttura identica in 5 lingue, corpo solo dove il testo approvato lo prevede', () => {
  for (const lang of LANGS) {
    const episode = (laboratorio(lang).series as Tree).episode as Tree
    assert.equal(str(episode.code), 'EP. 003', `${lang}: codice episodio`)
    assert.equal(str(episode.title), 'STAFF MEETING', `${lang}: titolo episodio`)
    if (lang === 'it') {
      assert.ok(str(episode.body).length > 0, 'it: il testo approvato dell episodio c e`')
    } else {
      // Il documento approvato consegna EP. 003 solo in italiano: nessuna traduzione inventata.
      assert.equal(str(episode.body), '', `${lang}: nessun corpo approvato per l episodio 003`)
    }
  }
})

test('i sei reparti vengono da una struttura dati, nell ordine della lavagna', () => {
  for (const lang of LANGS) {
    const messagesTree = laboratorio(lang) as Tree
    const staff = messagesTree.staff as Tree
    const t = (key: string): string => {
      const path = key.split('.')
      let node: unknown = messagesTree
      for (const part of path) node = (node as Tree)[part]
      assert.equal(typeof node, 'string', `${lang}: chiave staff mancante ${key}`)
      return node as string
    }
    const items = buildStaffItems(t)
    assert.equal(items.length, 6, `${lang}: sei reparti attesi`)
    assert.deepEqual(items.map((i) => i.id), [...STAFF_IDS])
    for (const item of items) {
      assert.ok(item.role.length > 0, `${lang}: ruolo vuoto per ${item.id}`)
      assert.ok(item.quote.length > 0, `${lang}: citazione vuota per ${item.id}`)
    }
    assert.equal(str(staff.boardLabel), "TODAY'S STAFF", `${lang}: etichetta di struttura diversa`)
    // La lavagna e' generata, non scritta a mano: nessun ruolo letterale nel componente.
    for (const item of items) {
      assert.ok(!boardSource.includes(item.role), `StaffBoard non deve contenere il ruolo letterale ${item.role}`)
      assert.ok(!pageSource.includes(item.role), `la pagina non deve contenere il ruolo letterale ${item.role}`)
    }
  }
  assert.match(boardSource, /STAFF_IDS/, 'la lavagna deve derivare da STAFF_IDS')
  assert.match(boardSource, /items\.map\(/, 'la lavagna deve rendere i reparti con una mappa')
})

test('nessuna parola vietata nei testi pubblici, salvo la negazione approvata sul personaggio', () => {
  // Parole vietate: claim biologici sulla pelle, confronti, il nome interno del personaggio.
  const forbidden = [/respir/i, /\bsud(a|ano|are|ata)\b/i, /rigener/i, /cadaver/i, /bugiard/i, /trasparent/i, /\bnano\b/i]
  // Unica occorrenza ammessa: la seconda regola della serie, che riguarda il personaggio
  // («il Pellaio non guarisce dal perfezionismo») ed e' testo approvato.
  const allowedGuarisce = [str((laboratorio('it').series as Tree).p2)]

  for (const lang of LANGS) {
    for (const value of leafValues(laboratorio(lang))) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(value), `${lang}: parola vietata ${pattern} in «${value}»`)
      }
      if (/guarisc/i.test(value)) {
        assert.ok(
          allowedGuarisce.includes(value),
          `${lang}: «guarisce» compare in un testo non approvato: «${value}»`,
        )
      }
    }
  }
})

test('la pagina non usa le immagini del vecchio Pellaio ne rimanda a un archivio SEBO', () => {
  for (const source of [pageSource, boardSource]) {
    assert.ok(!source.includes('/pellaio/'), 'nessun riferimento alle immagini del vecchio Pellaio')
    assert.ok(!/\/sebo\b/i.test(source), 'nessun link o riferimento a /sebo')
  }
  for (const lang of LANGS) {
    for (const value of leafValues(laboratorio(lang))) {
      assert.ok(!/sebo/i.test(value), `${lang}: il namespace laboratorio nomina ancora SEBO in «${value}»`)
    }
  }
  // Gli slot immagine esistono ma restano vuoti: nessun `src`, nessun `alt` inventato.
  assert.match(pageSource, /data-image-slot/, 'gli slot immagine devono essere predisposti')
  assert.ok(!/<img|next\/image/i.test(pageSource), 'nessuna immagine resa (slot vuoti)')
  assert.ok(!codeHasAlt(pageSource), 'nessun alt inventato')
})

function codeHasAlt(source: string): boolean {
  return /\balt=/.test(source)
}
