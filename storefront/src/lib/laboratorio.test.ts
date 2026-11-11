import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { FIGURE_GIORNATA, TELEGRAM_BOT_URL, buildGiornataItems, figuraPerOra, practiceSkinHref } from './laboratorio'

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
  // Un alt orfano su una voce senza figura e' un errore di contenuto, non un valore da tenere.
  assert.throws(() => buildGiornataItems([{ ora: '23:58', ruolo: '', testo: 'x', alt: 'una figura' }]), /non ammesso/)
  // La voce con la figura non si rende a meta': senza alt, o con un alt vuoto, e' un errore.
  assert.throws(() => buildGiornataItems([{ ora: '07:12', ruolo: 'Magazziniere', testo: 'x' }]), /alt manca/)
  assert.throws(() => buildGiornataItems([{ ora: '07:12', ruolo: 'Magazziniere', testo: 'x', alt: '   ' }]), /alt manca/)
  assert.throws(() => buildGiornataItems([{ ora: '07:12', ruolo: 'Magazziniere', testo: 'x', alt: 7 }]), /alt deve essere una stringa/)
  assert.deepEqual(buildGiornataItems([{ ora: '23:58', ruolo: '', testo: 'x' }]), [{ ora: '23:58', ruolo: '', testo: 'x', alt: '' }])
  assert.deepEqual(
    buildGiornataItems([{ ora: '07:12', ruolo: 'Magazziniere', testo: 'x', alt: '  descrizione del ruolo  ' }]),
    [{ ora: '07:12', ruolo: 'Magazziniere', testo: 'x', alt: 'descrizione del ruolo' }],
  )
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

/** I due ritagli approvati dell'immagine di testa, gli unici file di `public/pellaio/` fuori da `personaggi/`. */
const HERO_FILES = ['/pellaio/hero-pellaio-desktop.webp', '/pellaio/hero-pellaio-mobile.webp']
const heroFile = (ref: string) => new URL(`public${ref}`, new URL('../../', import.meta.url))

test('la pagina non usa le immagini del vecchio Pellaio ne rimanda a /sebo', () => {
  for (const source of [pageSource, libSource]) {
    assert.ok(!/\/pellaio\/pellaio-(?:0[1-3]|lab)/.test(source), 'nessun riferimento ai file del vecchio Pellaio')
    for (const ref of source.match(/\/pellaio\/[^'"`\s]*/g) ?? []) {
      assert.ok(
        ref === '/pellaio/personaggi' ||
          ref.startsWith('/pellaio/personaggi/') ||
          HERO_FILES.includes(ref),
        `immagine fuori dalla cartella approvata: ${ref}`,
      )
    }
    assert.ok(!/\/sebo\b/i.test(source), 'nessun link o riferimento a /sebo')
  }
  for (const lang of LANGS) {
    for (const value of leafValues(laboratorio(lang))) {
      assert.ok(!/sebo/i.test(value), `${lang}: il namespace laboratorio nomina ancora SEBO in «${value}»`)
    }
  }
  // Lo slot del laboratorio resta predisposto e vuoto finche' non arriva il suo asset.
  assert.match(pageSource, /data-image-slot/, 'lo slot immagine deve essere predisposto')
  assert.match(pageSource, /<ImageSlot slot="lab" \/>/, 'lo slot del laboratorio resta vuoto')
  // Il solo recapito esterno della pagina e` il bot del laboratorio.
  assert.ok(pageSource.includes('href={TELEGRAM_BOT_URL}'), 'il CTA deve puntare al bot del laboratorio')
  assert.ok(TELEGRAM_BOT_URL.startsWith('https://t.me/'), 'il recapito del bot deve essere il canale Telegram')
})

// ── L'immagine di testa (t_a27df990) ─────────────────────────────────────────────────────

test('la pagina rende l immagine di testa con i due ritagli approvati, dentro un <picture>', () => {
  for (const ref of HERO_FILES) {
    assert.ok(pageSource.includes(ref), `la pagina non referenzia ${ref}`)
  }
  // Art direction: il verticale entra sotto i 640px, il paesaggio resta il fallback dell'img.
  assert.match(
    pageSource,
    /<picture>[\s\S]*?<source media="\(max-width: 640px\)" srcSet="\/pellaio\/hero-pellaio-mobile\.webp"[\s\S]*?<img[\s\S]*?src="\/pellaio\/hero-pellaio-desktop\.webp"/,
    'picture/source/img non sono agganciati ai due file approvati',
  )
  // L'immagine sta sopra il blocco eyebrow + H1, non dentro e non dopo.
  const picture = pageSource.indexOf('<picture>')
  assert.ok(picture >= 0, 'picture assente')
  assert.ok(picture < pageSource.indexOf("t('hero.eyebrow')"), 'l immagine non precede l eyebrow')
  assert.ok(picture < pageSource.indexOf("t('hero.title')"), 'l immagine non precede l H1')
  // Niente testo sopra l immagine: il blocco hero e` immagine, poi eyebrow, H1 e sottotitolo.
  assert.ok(!pageSource.includes('<ImageSlot slot="hero" />'), 'lo slot vuoto dell hero non serve piu`')
})

test('l immagine di testa non ha CLS: width/height espliciti, eager e prioritaria', () => {
  const img = /<img[\s\S]*?\/>/.exec(pageSource)
  assert.ok(img, 'img dell hero assente')
  const tag = img[0]
  const width = /width=\{(\d+)\}/.exec(tag)
  const height = /height=\{(\d+)\}/.exec(tag)
  assert.ok(width, 'width esplicito assente sull img')
  assert.ok(height, 'height esplicito assente sull img')
  assert.equal(Number(width[1]), 1600, 'larghezza intrinseca del ritaglio desktop')
  assert.equal(Number(height[1]), 900, 'altezza intrinseca del ritaglio desktop')
  // Lo spazio riservato segue il file che il browser sceglie: stesso rapporto, stessa soglia.
  assert.match(tag, /aspect-\[752\/941\]/, 'rapporto del ritaglio verticale non riservato')
  assert.match(tag, /min-\[641px\]:aspect-\[1600\/900\]/, 'rapporto del ritaglio desktop non riservato')
  // Above the fold: caricamento immediato e alta priorita`, non lazy.
  assert.match(tag, /loading="eager"/, 'l immagine di testa non deve essere lazy')
  assert.match(tag, /fetchPriority="high"/, 'priorita` alta attesa sull immagine di testa')
  assert.match(tag, /decoding="async"/, 'decoding async atteso')
  assert.match(tag, /sizes="100vw"/, 'sizes atteso')
  // L alt viene dalle traduzioni: nessuna descrizione scritta a mano nel componente.
  assert.match(tag, /alt=\{t\('hero\.alt'\)\}/, 'alt non legato alla chiave hero.alt')
  assert.ok(!/object-(cover|contain)/.test(pageSource), 'nessun ritaglio: i rapporti riservati coincidono con i file')
  // Il <source> verticale dichiara le sue dimensioni intrinseche.
  const source = /<source[^>]*\/>/.exec(pageSource)
  assert.ok(source, 'source del ritaglio verticale assente')
  assert.match(source[0], /width=\{752\}/, 'larghezza del ritaglio verticale assente sul source')
  assert.match(source[0], /height=\{941\}/, 'altezza del ritaglio verticale assente sul source')
})

test('i due ritagli dell immagine di testa pesano meno di 200 KB in due e sono WebP validi', () => {
  let total = 0
  for (const ref of HERO_FILES) {
    const buffer = readFileSync(heroFile(ref))
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', `${ref}: non e un contenitore RIFF`)
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP', `${ref}: non e un WebP`)
    total += buffer.length
  }
  assert.ok(total < 200 * 1024, `i due ritagli pesano ${total} byte: il tetto e 200 KB`)
})

test('l alt dell immagine di testa esiste in tutte e cinque le lingue e non e quello inglese', () => {
  const alts = new Map<Lang, string>()
  for (const lang of LANGS) {
    const alt = str((laboratorio(lang).hero as Tree).alt).trim()
    assert.ok(alt.length >= 40, `${lang}: alt troppo corto: «${alt}»`)
    // L alt nomina il personaggio e il monocolo: la stessa scena, non una descrizione generica.
    assert.ok(/monocol|monocle|monokel|monóculo/i.test(alt), `${lang}: l alt non nomina il monocolo`)
    assert.ok(/Chieri/.test(alt), `${lang}: l alt non nomina il luogo`)
    alts.set(lang, alt)
  }
  const english = alts.get('en')
  assert.ok(english, 'alt inglese mancante')
  for (const lang of LANGS) {
    if (lang === 'en') continue
    assert.notEqual(alts.get(lang), english, `${lang}: alt rimasto in inglese`)
    assert.ok(!/\bthe\b|\bwith a\b|\bin the\b/i.test(alts.get(lang) as string), `${lang}: alt con testo inglese`)
  }
})

// ── Le sei figure dei ruoli ──────────────────────────────────────────────────────────────

const personaPath = (file: string) => new URL(`public/pellaio/personaggi/${file}`, new URL('../../', import.meta.url))

/** Ogni figura ha una voce con un reparto, e le sei voci con reparto sono tutte coperte. */
const ORE_FIGURA = ['07:12', '09:40', '11:05', '14:20', '16:45', '19:30']

/** Dimensioni e trasparenza lette davvero dall'header WebP: non si fidano della tabella. */
function webpInfo(file: string): { width: number; height: number; alpha: boolean; bytes: number } {
  const buffer = readFileSync(personaPath(file))
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', `${file}: non e un contenitore RIFF`)
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP', `${file}: non e un WebP`)
  assert.equal(buffer.toString('ascii', 12, 16), 'VP8X', `${file}: atteso WebP esteso (VP8X)`)
  const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16))
  const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16))
  return { width, height, alpha: (buffer[20] & 0x10) !== 0, bytes: buffer.length }
}

test('le sei figure esistono, sono WebP con trasparenza e la tabella dichiara le dimensioni vere', () => {
  assert.equal(FIGURE_GIORNATA.length, 6, 'sei figure attese')
  assert.deepEqual(FIGURE_GIORNATA.map((figura) => figura.ruolo), [
    'Magazziniere',
    'Segreteria',
    'Call center',
    'Chimico',
    'CEO',
    'Pulizie',
  ], 'ruoli canonici delle figure')

  let total = 0
  for (const figura of FIGURE_GIORNATA) {
    const file = figura.src.slice('/pellaio/personaggi/'.length)
    assert.ok(existsSync(personaPath(file)), `${file}: file mancante in public/pellaio/personaggi/`)
    const info = webpInfo(file)
    assert.equal(info.width, figura.width, `${file}: larghezza dichiarata ≠ larghezza del file`)
    assert.equal(info.height, figura.height, `${file}: altezza dichiarata ≠ altezza del file`)
    assert.ok(info.alpha, `${file}: WebP senza canale alpha, la trasparenza e dichiarata e deve esserci`)
    assert.ok(figura.height >= 2 * 168, `${file}: la sorgente deve coprire la resa 2x da 168px`)
    total += info.bytes
  }
  assert.ok(total < 500 * 1024, `le sei figure pesano ${total} byte: il tetto e 500 KB`)

  // Il README della cartella dichiara fonte, metodo, stato, limiti e la larghezza reale dei file.
  const widths = FIGURE_GIORNATA.map((figura) => figura.width)
  const range = `${Math.min(...widths)}–${Math.max(...widths)}`
  assert.ok(Math.max(...widths) <= 430, `figura piu larga di un ritaglio non-hero: ${range}`)
  const readme = readFileSync(personaPath('README.md'), 'utf8')
  for (const needle of ['30/10', 'FRONT', 'segmentazione', 'Provvisorio', 'frangia residua', `${range} px`]) {
    assert.ok(readme.includes(needle), `README dei personaggi senza «${needle}»`)
  }
})

test('mappatura ruolo -> file: ogni figura e agganciata alla voce del suo ruolo, in tutte le lingue', () => {
  const itVoci = buildGiornataItems((laboratorio('it').giornata as Tree).items)
  assert.deepEqual(itVoci.filter((voce) => figuraPerOra(voce.ora)).map((voce) => voce.ora), ORE_FIGURA)
  // La tabella nomina il ruolo che la pagina italiana mostra a quell'ora: la mappatura e' esplicita.
  for (const [index, figura] of FIGURE_GIORNATA.entries()) {
    const voce = itVoci.find((candidate) => candidate.ora === ORE_FIGURA[index])
    assert.ok(voce, `voce ${ORE_FIGURA[index]} assente`)
    assert.equal(figura.ruolo, voce.ruolo, `la figura ${figura.src} non e il ruolo della voce ${voce.ora}`)
  }
  // Nessuna figura per la voce senza reparto, e nessun doppione di file o di ruolo.
  assert.equal(figuraPerOra('23:58'), null, 'la voce delle 23:58 non ha una figura')
  assert.equal(figuraPerOra('00:00'), null, 'un orario sconosciuto non riceve una figura')
  assert.equal(new Set(FIGURE_GIORNATA.map((figura) => figura.src)).size, 6, 'sei file distinti')
  assert.equal(new Set(FIGURE_GIORNATA.map((figura) => figura.ruolo)).size, 6, 'sei ruoli distinti')

  // In ogni lingua la figura cade sulla voce che ha quel reparto, e l'alt e' tradotto con quel ruolo.
  const itAlts = new Map(itVoci.map((voce) => [voce.ora, voce.alt]))
  for (const lang of LANGS) {
    const voci = buildGiornataItems((laboratorio(lang).giornata as Tree).items)
    for (const [index, ora] of ORE_FIGURA.entries()) {
      const voce = voci.find((candidate) => candidate.ora === ora)
      assert.ok(voce, `${lang}: voce ${ora} assente`)
      assert.ok(voce.ruolo.length > 0, `${lang}: voce ${ora} senza ruolo`)
      assert.equal(figuraPerOra(ora)?.ruolo, FIGURE_GIORNATA[index].ruolo, `${lang}: figura della voce ${ora}`)
      assert.ok(voce.alt.length >= 25, `${lang}: alt troppo corto per ${ora}: «${voce.alt}»`)
      assert.ok(voce.alt.includes(voce.ruolo), `${lang}: l alt di ${ora} non nomina il ruolo «${voce.ruolo}»`)
      if (lang !== 'it') {
        assert.notEqual(voce.alt, itAlts.get(ora), `${lang}: alt della voce ${ora} e rimasto in italiano`)
      }
    }
    const senzaFigura = voci.find((candidate) => candidate.ora === '23:58')
    assert.equal(senzaFigura?.alt, '', `${lang}: alt orfano sulla voce senza reparto`)
  }
})

test('la pagina rende le figure con alt, dimensioni dichiarate, lazy e altezza normalizzata', () => {
  // La figura viene dalla tabella, non da un percorso scritto a mano nel componente.
  assert.match(pageSource, /figuraPerOra\(voce\.ora\)/, 'la pagina non risolve la figura della voce')
  assert.match(pageSource, /<Image[\s\S]*?src=\{figura\.src\}/, 'la figura non arriva dalla tabella')
  assert.match(pageSource, /alt=\{voce\.alt\}/, 'alt non legato alla voce: nessun alt o alt inventato')
  assert.match(pageSource, /width=\{figura\.width\}/, 'larghezza intrinseca assente: layout shift')
  assert.match(pageSource, /height=\{figura\.height\}/, 'altezza intrinseca assente: layout shift')
  assert.match(pageSource, /loading="lazy"/, 'le figure sotto la piega devono essere lazy')
  assert.match(pageSource, /decoding="async"/, 'decoding async atteso')
  // Altezza comune (168 desktop, 112 mobile) e larghezza automatica: nessuna deformazione, niente cover.
  assert.match(pageSource, /h-\[112px\][^"']*sm:h-\[168px\]|sm:h-\[168px\][^"']*h-\[112px\]/, 'altezze 112/168 assenti')
  assert.match(pageSource, /w-auto/, 'larghezza non automatica: la figura si deformerebbe')
  assert.ok(!/object-(cover|contain)/.test(pageSource), 'nessun ritaglio della figura')
  // I piedi si allineano sul fondo della riga.
  assert.match(pageSource, /flex items-end/, 'le figure non sono allineate sui piedi')
  assert.ok(!/background(Image|Image)?[\s\S]{0,20}pellaio/.test(pageSource), 'la figura non e un background')
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
