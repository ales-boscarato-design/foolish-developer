import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
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
 * file** su ogni file di `src/` (quindi anche un asset importato con alias, una regola CSS con
 * `url(...)`, un `<img>`), e sul teaser vieta ogni strada che possa rendere un'immagine.
 */

/** I quattro file di `public/pellaio/`, per nome: l'import con alias non contiene la barra. */
const FORBIDDEN_TOKENS = ['/pellaio/', 'pellaio-01', 'pellaio-02', 'pellaio-03', 'pellaio-lab']
/** Il vecchio personaggio ha anche una cartella gemella, mai referenziata: stessa regola. */
const FORBIDDEN_FRANK = ['/frank/', 'frank-01', 'frank-02', 'frank-03', 'frank-lab']

const homeSource = readFileSync(new URL('../app/[locale]/page.tsx', import.meta.url), 'utf8')

/** Ogni file di `src/`, test esclusi: `.ts`, `.tsx`, `.css`, `.json`, quel che c'e'. */
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
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue
      out.push({ rel: childRel, source: readFileSync(child, 'utf8') })
    }
  }
  walk(root, '')
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
})

test('nessun file del prodotto referenzia gli asset del vecchio personaggio', () => {
  const offenders: string[] = []
  for (const { rel, source } of productSources()) {
    for (const token of [...FORBIDDEN_TOKENS, ...FORBIDDEN_FRANK]) {
      if (source.includes(token)) offenders.push(`${rel} → ${token}`)
    }
  }
  assert.deepEqual(offenders, [], 'nessun file di src/ deve servire le immagini del vecchio personaggio')
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
    [/next\/image/, 'l\'import di next/image'],
    [/\bsrc=/, 'un attributo src'],
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
  for (const pattern of [/\bsrc=/, /\balt=/, /<Image\b/, /<img\b/, /\burl\(/, /background-?image/i]) {
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
