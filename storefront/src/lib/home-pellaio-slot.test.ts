import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import test from 'node:test'

/**
 * Il teaser «laboratorio» della home mostrava `public/pellaio/pellaio-03.png`, un'immagine del
 * personaggio precedente che contraddice il nuovo Pellaio (Il Pellaio — The Precision Inspector)
 * descritto da `/{lingua}/laboratorio`.
 *
 * Decisione di Alessandro (5/11/2026): opzione (c) — lo slot immagine resta predisposto e vuoto
 * finche' non arriva un asset approvato, senza segnaposto e senza `alt` inventati. Questi test
 * sono il guardiano di quella decisione: falliscono se il vecchio personaggio rientra nel codice.
 *
 * La guardia non si limita alla forma letterale `<Image src="/pellaio/...">`: cerca i **nomi dei
 * file** (`pellaio-01/02/03/-lab`, `frank-*`) su tutto `src/` piu' i punti da cui un percorso puo'
 * arrivare nel bundle senza comparire in un componente (`messages/*.json`, `next.config.ts`), e
 * sul teaser vieta ogni strada che possa rendere un'immagine.
 *
 * ATTENZIONE: quando arrivera' l'asset approvato del nuovo Pellaio, questo file va aggiornato
 * insieme a `page.tsx` — il teaser vieta `src=`/`alt=` per costruzione. E' un tripwire voluto:
 * l'immagine non deve poter rientrare senza che qualcuno lo dichiari.
 */

/**
 * Il vecchio personaggio, per **nome di file** (un import puo' essere `@/…` senza la barra).
 *
 * Il prefisso `/pellaio/` da solo non e' piu' un token vietato: la stessa cartella ospita ora i
 * **sei ritagli approvati dei ruoli** (sotto `personaggi/`, card t_3458967b) e i **due ritagli
 * dell'immagine di testa** di `/laboratorio` (card t_a27df990). A distinguerli dai vecchi file e'
 * `pellaioReferences()`, che accetta solo quelle due destinazioni: un riferimento a qualunque
 * altro file di `public/pellaio/` continua a far fallire la guardia.
 */
const FORBIDDEN_TOKENS = ['pellaio-01', 'pellaio-02', 'pellaio-03', 'pellaio-lab', 'pellaio.png']
/** L'unica sottocartella di `public/pellaio/` che il prodotto puo' servire: i sei ruoli. */
const ALLOWED_PELLAIO_DIR = '/pellaio/personaggi'
/**
 * I due file approvati dell'immagine di testa di `/laboratorio`, elencati per nome esatto: il
 * permesso vale per questi due, non per la cartella. Le due immagini sono i ritagli definitivi
 * del Pellaio (desktop 1600x900, mobile 752x941) forniti da Alessandro.
 */
const APPROVED_PELLAIO_FILES = ['/pellaio/hero-pellaio-desktop.webp', '/pellaio/hero-pellaio-mobile.webp']
/** Il vecchio personaggio ha anche una cartella gemella, mai referenziata: stessa regola. */
const FORBIDDEN_FRANK = ['/frank/', 'frank-01', 'frank-02', 'frank-03', 'frank-lab']

/**
 * Un percorso `/pellaio/...` e' ammesso se sta sotto la sottocartella dei ruoli o se e' uno dei
 * due file dell'immagine di testa.
 */
function pellaioRefAllowed(ref: string): boolean {
  return ref === ALLOWED_PELLAIO_DIR || ref.startsWith(`${ALLOWED_PELLAIO_DIR}/`) || APPROVED_PELLAIO_FILES.includes(ref)
}

/**
 * Ogni percorso `/pellaio/...` presente in un sorgente. Serve a vietare la cartella intera tranne
 * la sottocartella approvata: senza, togliere il token `/pellaio/` aprirebbe un buco (basterebbe
 * referenziare `pellaio-qualunque.png` per tornare al personaggio precedente con un altro nome).
 */
function pellaioReferences(source: string): string[] {
  return source.match(/\/pellaio\/[^'"`\s,)]*/g) ?? []
}

const homeSource = readFileSync(new URL('../app/[locale]/page.tsx', import.meta.url), 'utf8')

/**
 * I file in cui un percorso del vecchio personaggio puo' nascondersi e finire comunque nel
 * bundle: tutto `src/` (componenti, CSS, dati), i messaggi i18n e la config dei rewrite.
 */
function scannedSources(): { rel: string; source: string }[] {
  const srcRoot = new URL('../', import.meta.url)
  const appRoot = new URL('../../', import.meta.url)
  const out: { rel: string; source: string }[] = []
  const walk = (dir: URL, rel: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)
      if (entry.isDirectory()) {
        walk(child, childRel)
        continue
      }
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      out.push({ rel: childRel, source: readFileSync(child, 'utf8') })
    }
  }
  walk(srcRoot, 'src')
  for (const name of readdirSync(new URL('messages/', appRoot))) {
    if (!name.endsWith('.json')) continue
    out.push({ rel: `messages/${name}`, source: readFileSync(new URL(`messages/${name}`, appRoot), 'utf8') })
  }
  out.push({ rel: 'next.config.ts', source: readFileSync(new URL('next.config.ts', appRoot), 'utf8') })
  return out
}

/** Il blocco del teaser: dal commento di sezione alla chiusura `</section>`. */
function teaserSection(source: string): string {
  const start = source.indexOf('PELLAIO — Teaser atmosferico')
  assert.ok(start !== -1, 'il teaser del Pellaio deve esistere nella home')
  const end = source.indexOf('</section>', start)
  assert.ok(end !== -1, 'il teaser del Pellaio deve chiudersi con </section>')
  return source.slice(start, end)
}

/** Il corpo della funzione `ImageSlot`, dalla sua dichiarazione alla graffa di chiusura. */
function imageSlotBody(source: string): string {
  const start = source.indexOf('function ImageSlot')
  assert.ok(start !== -1, 'la home deve avere un componente ImageSlot')
  const end = source.indexOf('\n}', start)
  assert.ok(end !== -1, 'ImageSlot deve chiudersi con una graffa in colonna')
  return source.slice(start, end)
}

test('la home non referenzia piu` le immagini del vecchio Pellaio', () => {
  for (const token of [...FORBIDDEN_TOKENS, ...FORBIDDEN_FRANK]) {
    assert.ok(!homeSource.includes(token), `la home non deve contenere ${token}`)
  }
  assert.ok(!homeSource.includes('pellaio.png'), 'la home non deve servire pellaio.png')
  // Sulla home la regola resta assoluta: nessun file di `public/pellaio/`, nemmeno i ritagli nuovi
  // (i sei ruoli vivono in `/laboratorio`, non nel teaser: lo slot della home resta vuoto).
  assert.deepEqual(pellaioReferences(homeSource), [], 'la home non deve referenziare alcun file di /pellaio/')
})

test('nessun file del prodotto referenzia gli asset del vecchio personaggio', () => {
  const offenders: string[] = []
  for (const { rel, source } of scannedSources()) {
    for (const token of [...FORBIDDEN_TOKENS, ...FORBIDDEN_FRANK]) {
      if (source.includes(token)) offenders.push(`${rel} → ${token}`)
    }
    for (const ref of pellaioReferences(source)) {
      if (!pellaioRefAllowed(ref)) offenders.push(`${rel} → ${ref}`)
    }
  }
  assert.deepEqual(offenders, [], 'nessun file servito deve referenziare le immagini del vecchio personaggio')
})

test('il permesso sui file dell immagine di testa vale per i due approvati, che esistono davvero', () => {
  // L'allow-list non e' una scorciatoia: due soli file, presenti su disco, ognuno con la sua
  // immagine sotto la soglia dichiarata. Un terzo file in `public/pellaio/` resta non referenziabile.
  assert.equal(APPROVED_PELLAIO_FILES.length, 2, 'due file approvati attesi')
  const publicRoot = new URL('../../public/', import.meta.url)
  for (const ref of APPROVED_PELLAIO_FILES) {
    const info = statSync(new URL(ref.replace(/^\//, ''), publicRoot))
    assert.ok(info.isFile(), `${ref}: file approvato mancante in public/`)
    assert.ok(info.size > 0 && info.size < 200 * 1024, `${ref}: ${info.size} byte, fuori dai limiti attesi`)
  }
  // Le guardie sui vecchi nomi non si sono allentate.
  for (const name of ['pellaio-01', 'pellaio-02', 'pellaio-03', 'pellaio-lab']) {
    assert.ok(!APPROVED_PELLAIO_FILES.some((ref) => ref.includes(name)), `${name} non e' un file approvato`)
    assert.ok(pellaioRefAllowed(`/pellaio/${name}.png`) === false, `${name} non deve essere referenziabile`)
  }
  assert.equal(pellaioRefAllowed('/pellaio/personaggi/pellaio-ceo.webp'), true, 'i sei ruoli restano ammessi')
})

test('il teaser tiene lo slot predisposto e vuoto, senza immagine ne` alt inventati', () => {
  const section = teaserSection(homeSource)

  // Lo slot esiste ed e` quello della home: punto d'innesto per l'asset approvato.
  assert.match(section, /<ImageSlot slot="home-pellaio" \/>/, 'lo slot immagine del teaser deve essere predisposto')

  // Vuoto: nessuna immagine resa, nessun `src`, nessun `alt` inventato, nessuna immagine di
  // sfondo che possa riempire lo slot per via traversa.
  const cheats: [RegExp, string][] = [
    [/<Image\b/, 'un <Image> di next/image'],
    [/<img\b/, 'un <img>'],
    [/<picture\b|<source\b|<video\b|<iframe\b/, 'un elemento che serve un\'immagine (picture/source/video/iframe)'],
    [/next\/image/, 'l\'import di next/image'],
    [/\bsrc(?:[Ss]et)?=/, 'un attributo src o srcSet'],
    [/\bposter=/, 'un attributo poster'],
    [/\balt=/, 'un attributo alt'],
    [/background-?image/i, 'un\'immagine di sfondo'],
    [/\burl\(/, 'una url() (CSS o style)'],
  ]
  for (const [pattern, what] of cheats) {
    assert.ok(!pattern.test(section), `lo slot vuoto non deve contenere ${what}`)
  }
})

test('ImageSlot resta il div nascosto approvato (nessun figlio, nessuna immagine)', () => {
  const body = imageSlotBody(homeSource)

  // Il meccanismo e` quello approvato su /laboratorio (PR #37): div nascosto, invisibile anche
  // all'albero di accessibilita`, agganciato dal suo `data-image-slot`.
  assert.match(body, /data-image-slot=\{slot\}/, 'ImageSlot deve esporre data-image-slot')
  assert.match(body, /\baria-hidden="true"/, 'lo slot vuoto deve essere nascosto all\'accessibilita`')
  assert.match(body, /\bhidden\b/, 'lo slot vuoto deve essere nascosto')

  // Le guardie qui sopra sono ancorate al comportamento (direttive), non alla formattazione:
  // ma il componente non deve diventare un modo per rendere un'immagine.
  for (const pattern of [/\bsrc(?:[Ss]et)?=/, /\bposter=/, /\balt=/, /<Image\b/, /<img\b/, /<picture\b|<source\b/, /\burl\(/, /background-?image/i]) {
    assert.ok(!pattern.test(body), `ImageSlot non deve contenere ${pattern}`)
  }
  // Nessun figlio: l'elemento restituito si chiude da se'.
  const returned = body.slice(body.indexOf('return '))
  assert.match(returned, /\/>\s*$/, 'lo slot non deve avere figli: l\'elemento restituito si chiude da se\'')
})

test('il teaser e` una colonna sola: nessun residuo della griglia a due colonne', () => {
  const section = teaserSection(homeSource)
  assert.ok(!/md:grid-cols-\[1fr_340px\]/.test(section), 'la colonna immagine e` collassata: via la griglia 1fr_340px')
  assert.ok(!/aspect-\[3\/4\]/.test(section), 'via il riquadro 3/4 che ospitava la vecchia immagine')
  assert.ok(!/\bgap-10\b/.test(section), 'via il gap della griglia a due colonne')
})
