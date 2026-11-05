import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { TELEGRAM_BOT_URL, buildGiornataItems, practiceSkinHref } from './laboratorio'

/**
 * La pagina `/laboratorio` e' fatta di testi approvati da Alessandro il 5/11/2026 e non
 * riscritti. Questi test congelano quel testo: il file di fixture e' la copia byte per byte del
 * documento approvato (`sha256 db849d31…`), e ogni valore mostrato dalla pagina deve ricomporre
 * il blocco corrispondente, lingua per lingua.
 */

type Lang = 'it' | 'en' | 'fr' | 'es' | 'de'

const LANGS: Lang[] = ['it', 'en', 'fr', 'es', 'de']
/** Nel documento approvato l'italiano usa le intestazioni `## n.`, le altre lingue il formato compatto. */
const COMPACT: Record<Lang, boolean> = { it: false, en: true, fr: true, es: true, de: true }
/** Sezioni del documento: 1 hero, 2 chi e', 3 una giornata, 4 il laboratorio, 5 il paradosso, 6 il ponte, 7 CTA. */
const BLOCKS = [2, 3, 4, 5, 6, 7] as const

type Tree = Record<string, unknown>

const readJson = (abs: URL) => JSON.parse(readFileSync(abs, 'utf8')) as Tree
const messages = (lang: Lang): Tree => readJson(new URL(`../../messages/${lang}.json`, import.meta.url))
const laboratorio = (lang: Lang): Tree => messages(lang).laboratorio as Tree
const pageSource = readFileSync(new URL('../app/[locale]/laboratorio/page.tsx', import.meta.url), 'utf8')
const libSource = readFileSync(new URL('./laboratorio.ts', import.meta.url), 'utf8')

/** Percorsi delle chiavi foglia: gli array si aprono per indice, cosi' la parita' copre anche le voci orarie. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((entry, i) => leafKeys(entry, `${prefix}.${i}`))
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value as Tree).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k))
}

function leafValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(leafValues)
  if (value === null || typeof value !== 'object') return [String(value)]
  return Object.values(value as Tree).flatMap(leafValues)
}

const str = (value: unknown): string => {
  assert.equal(typeof value, 'string')
  return value as string
}

// ── Testi approvati: parsing del documento di fixture ────────────────────────────────────

const APPROVED_BYTES = readFileSync(new URL('./__fixtures__/laboratorio-testi-approvati.md', import.meta.url))
/** sha256 del documento approvato il 5/11/2026: la fixture non deve derivare. */
const APPROVED_SHA256 = 'db849d3170d6fed8ad2f04e507c9457b76b3dbbff77ee8adf9dcdb0bc7738001'
const APPROVED = APPROVED_BYTES.toString('utf8')

function normalize(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function langChunks(raw: string): Record<Lang, string> {
  // Le note di implementazione in coda al documento non sono testo pubblicato.
  const body = raw.split(/^## Note per l'implementazione/m)[0]
  const names: Record<string, Lang> = { ENGLISH: 'en', FRANÇAIS: 'fr', ESPAÑOL: 'es', DEUTSCH: 'de' }
  const parts = body.split(/^# (ENGLISH|FRANÇAIS|ESPAÑOL|DEUTSCH)\s*$/m)
  const out: Record<string, string> = { it: parts[0] }
  for (let i = 1; i < parts.length; i += 2) out[names[parts[i]]] = parts[i + 1]
  return out as Record<Lang, string>
}

function rawSections(chunk: string, compact: boolean): Record<number, string[]> {
  const collected: Record<number, string[]> = {}
  let current: number | null = null
  for (const line of chunk.split('\n')) {
    if (line.trim() === '---') continue
    if (compact) {
      const head = /^\*\*(\d)\.\*\*\s*(.*)$/.exec(line)
      if (head) {
        current = Number(head[1])
        collected[current] = [head[2]]
        continue
      }
      if (current !== null && line.trim()) collected[current].push(line.trim())
      continue
    }
    const head = /^## (\d)\./.exec(line)
    if (head) {
      current = Number(head[1])
      collected[current] = []
      continue
    }
    if (current !== null) collected[current].push(line)
  }
  return collected
}

function sectionsOf(chunk: string, compact: boolean): Record<number, string> {
  const out: Record<number, string> = {}
  for (const [k, lines] of Object.entries(rawSections(chunk, compact))) out[Number(k)] = normalize(lines.join('\n'))
  return out
}

const CHUNKS = langChunks(APPROVED)
const BLOCK = (lang: Lang, n: number) => sectionsOf(CHUNKS[lang], COMPACT[lang])[n]

const EYEBROW = 'FOOLISH LAB · CHIERI (TO)'
const HERO_NAME: Record<Lang, string> = {
  it: 'Il Pellaio.',
  en: 'The Tanner.',
  fr: 'Le Peaussier.',
  es: 'El Pellejero.',
  de: 'Der Häuter.',
}

/** L'hero nel documento: etichette esplicite in italiano, forma compatta nelle altre lingue. */
function heroExpected(lang: Lang): [string, string, string] {
  const lines = rawSections(CHUNKS[lang], COMPACT[lang])[1]
  assert.ok(lines, `${lang}: hero non trovato`)
  const first = normalize(lines.join(' '))
  if (COMPACT[lang]) {
    const cut = first.indexOf(HERO_NAME[lang])
    assert.ok(cut > 0, `${lang}: sottotitolo dell hero non riconosciuto`)
    const head = first.slice(0, cut).trim()
    const title = head.replace(/^.*? — /, '').replace(/ —$/, '')
    return [EYEBROW, title, first.slice(cut)]
  }
  const found = new Map<string, string>()
  for (const line of lines) {
    const parsed = /^(eyebrow|H1|sub) — (.*)$/.exec(line.trim())
    if (parsed) found.set(parsed[1], parsed[2].trim())
  }
  return [found.get('eyebrow') ?? '', found.get('H1') ?? '', found.get('sub') ?? '']
}

// ── Test ────────────────────────────────────────────────────────────────────────────────

test('il documento di fixture e` byte per byte quello approvato', () => {
  assert.equal(createHash('sha256').update(APPROVED_BYTES).digest('hex'), APPROVED_SHA256)
})

test('parita` delle chiavi i18n: il namespace laboratorio ha lo stesso set nelle 5 lingue', () => {
  const sets = Object.fromEntries(LANGS.map((l) => [l, new Set(leafKeys(laboratorio(l)))])) as Record<Lang, Set<string>>
  const reference = sets.it
  for (const lang of LANGS) {
    const missing = [...reference].filter((k) => !sets[lang].has(k))
    const extra = [...sets[lang]].filter((k) => !reference.has(k))
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${lang}: chiavi divergenti`)
  }
  // La parita` vale anche sul numero di voci orarie: un array piu` corto cambia il set di chiavi.
  for (const lang of LANGS) {
    const items = (laboratorio(lang).giornata as Tree).items
    assert.ok(Array.isArray(items), `${lang}: giornata.items deve essere un array`)
    assert.equal((items as unknown[]).length, 7, `${lang}: sette voci orarie attese`)
  }
})

test('testi approvati: ogni blocco della pagina ricompone il documento, per tutte e 5 le lingue', () => {
  for (const lang of LANGS) {
    const lab = laboratorio(lang)
    const [eyebrow, title, sub] = heroExpected(lang)
    const hero = lab.hero as Tree
    assert.deepEqual(
      [str(hero.eyebrow), str(hero.title), str(hero.sub)],
      [eyebrow, title, sub],
      `${lang}: hero diverso dal testo approvato`,
    )

    const intro = lab.intro as Tree
    const giornata = lab.giornata as Tree
    const voci = buildGiornataItems(giornata.items)
    const labSection = lab.lab as Tree
    const paradox = lab.paradox as Tree
    const ponte = lab.ponte as Tree
    const cta = lab.cta as Tree

    const expected: Record<number, string> = {
      2: [intro.p1, intro.p2, intro.p3].map(str).join(' '),
      3: [
        str(giornata.intro),
        ...voci.map((voce) => (voce.ruolo ? `- ${voce.ora} — ${voce.ruolo}. ${voce.testo}` : `- ${voce.ora} — ${voce.testo}`)),
      ].join(' '),
      4: [labSection.p1, labSection.p2, labSection.p3].map(str).join(' '),
      5: [paradox.intro, paradox.p1, paradox.p2, paradox.closing].map(str).join(' '),
      6: [ponte.p1, ponte.p2].map(str).join(' '),
      7: `${str(cta.title)} → ${str(cta.practiceSkin)} (${practiceSkinHref(lang)}) · ${str(cta.bot)}`,
    }

    for (const n of BLOCKS) {
      // Il documento annota la destinazione del link al bot («(bot)»): non e` testo pubblicato.
      const approved = BLOCK(lang, n).replace(/ \(bot\)$/, '')
      assert.equal(expected[n], approved, `${lang}: blocco ${n} non coincide con il testo approvato`)
    }
  }
})

test('la sezione serie, la scala e la card dei sei reparti non esistono piu` in nessuna lingua', () => {
  const removed = ['series', 'scale', 'staff', 'serie', 'scala']
  const removedClaims = [/sei motori/i, /two rules/i, /due regole/i, /EP\.\s*003/, /STAFF MEETING/]
  for (const lang of LANGS) {
    const lab = laboratorio(lang) as Tree
    for (const key of removed) {
      assert.ok(!(key in lab), `${lang}: la sezione «${key}» e' ancora presente`)
    }
    for (const value of leafValues(lab)) {
      for (const pattern of removedClaims) {
        assert.ok(!pattern.test(value), `${lang}: testo di una sezione rimossa ancora presente in «${value}»`)
      }
    }
  }
})

test('una giornata: sette voci con l orario approvato, dati nei file lingua e non nel componente', () => {
  const ORE = ['07:12', '09:40', '11:05', '14:20', '16:45', '19:30', '23:58']
  for (const lang of LANGS) {
    const voci = buildGiornataItems((laboratorio(lang).giornata as Tree).items)
    assert.deepEqual(voci.map((v) => v.ora), ORE, `${lang}: orari della giornata`)
    for (const voce of voci) {
      assert.ok(voce.testo.length > 0, `${lang}: voce ${voce.ora} senza testo`)
      if (voce.ora !== '23:58') {
        assert.ok(voce.ruolo.length > 0, `${lang}: voce ${voce.ora} senza ruolo`)
        assert.ok(!voce.ruolo.includes('.'), `${lang}: ruolo ${voce.ruolo} non riconosciuto`)
      } else {
        assert.equal(voce.ruolo, '', `${lang}: la voce delle 23:58 non ha un reparto`)
      }
      assert.ok(!pageSource.includes(voce.ora), `la pagina non deve contenere l orario letterale ${voce.ora}`)
      assert.ok(!pageSource.includes(voce.testo), 'la pagina non deve contenere il testo letterale di una voce')
    }
  }
})

test('buildGiornataItems fallisce chiuso su una struttura non conforme', () => {
  assert.throws(() => buildGiornataItems('nope'), /array/)
  assert.throws(() => buildGiornataItems([{ ora: '07:12', ruolo: 'X' }]), /testo/)
  assert.throws(() => buildGiornataItems([{ ora: 712, ruolo: 'X', testo: 'y' }]), /ora/)
  assert.deepEqual(buildGiornataItems([{ ora: '07:12', ruolo: '', testo: 'x' }]), [{ ora: '07:12', ruolo: '', testo: 'x' }])
})

test('nessuna parola vietata nei testi pubblici', () => {
  // Parole vietate: claim biologici sulla pelle, confronti, il nome interno del personaggio.
  const forbidden = [
    /respir/i,
    /\bsud(a|ano|are|ata)\b/i,
    /rigener/i,
    /guarisc/i,
    /cadaver/i,
    /bugiard/i,
    /trasparent/i,
    /\bnano\b/i,
    /archivi/i,
  ]
  for (const lang of LANGS) {
    for (const value of leafValues(laboratorio(lang))) {
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(value), `${lang}: parola vietata ${pattern} in «${value}»`)
      }
    }
  }
})

test('la pagina non usa le immagini del vecchio Pellaio ne rimanda a /sebo', () => {
  for (const source of [pageSource, libSource]) {
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
  assert.ok(!/\balt=/.test(pageSource), 'nessun alt inventato')
  // Il solo recapito esterno della pagina e` il bot del laboratorio.
  assert.ok(pageSource.includes('href={TELEGRAM_BOT_URL}'), 'il CTA deve puntare al bot del laboratorio')
  assert.ok(TELEGRAM_BOT_URL.startsWith('https://t.me/'), 'il recapito del bot deve essere il canale Telegram')
})

test('ogni chiave approvata e` agganciata alla pagina: nessun testo orfano', () => {
  const source = `${pageSource}\n${libSource}`
  for (const key of leafKeys(laboratorio('it'))) {
    if (key.startsWith('giornata.items.')) {
      assert.ok(pageSource.includes("t.raw('giornata.items')"), 'la pagina non legge giornata.items')
      assert.ok(libSource.includes('ora, ruolo, testo'), 'la struttura delle voci orarie non e` validata')
      continue
    }
    assert.ok(source.includes(`'${key}'`), `la pagina non legge la chiave approvata ${key}`)
  }
})

test('i sette blocchi sono nell ordine approvato: hero, chi e, una giornata, il laboratorio, il paradosso, il ponte, CTA', () => {
  const order = ["t('hero.title')", "t('intro.p1')", "t('giornata.intro')", "t('lab.p1')", "t('paradox.intro')", "t('ponte.p1')", "t('cta.title')"]
  const positions = order.map((needle) => pageSource.indexOf(needle))
  for (const [index, position] of positions.entries()) {
    assert.ok(position >= 0, `la pagina non rende ${order[index]}`)
  }
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `ordine dei blocchi non rispettato: ${positions.join(',')}`)
})
