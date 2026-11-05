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
 */

const homeSource = readFileSync(new URL('../app/[locale]/page.tsx', import.meta.url), 'utf8')

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

/** Il blocco del teaser: dal commento di sezione alla chiusura `</section>`. */
function teaserSection(source: string): string {
  const start = source.indexOf('PELLAIO — Teaser atmosferico')
  assert.ok(start !== -1, 'il teaser del Pellaio deve esistere nella home')
  const end = source.indexOf('</section>', start)
  assert.ok(end !== -1, 'il teaser del Pellaio deve chiudersi con </section>')
  return source.slice(start, end)
}

test('la home non referenzia piu` le immagini del vecchio Pellaio', () => {
  assert.ok(!homeSource.includes('/pellaio/'), 'la home non deve servire /pellaio/*')
  assert.ok(!homeSource.includes('/frank/'), 'la home non deve servire /frank/*')
})

test('nessun sorgente del prodotto referenzia /pellaio/', () => {
  const offenders = productSources()
    .filter(({ source }) => source.includes('/pellaio/'))
    .map(({ rel }) => rel)
  assert.deepEqual(offenders, [], 'nessun sorgente deve servire le immagini del vecchio Pellaio')
})

test('il teaser tiene lo slot predisposto e vuoto, senza immagine ne` alt inventati', () => {
  const section = teaserSection(homeSource)

  // Lo slot esiste ed e` quello della home: punto d'innesto per l'asset approvato.
  assert.match(section, /<ImageSlot slot="home-pellaio" \/>/, 'lo slot immagine del teaser deve essere predisposto')

  // Vuoto: nessuna immagine resa, nessun `src`, nessun `alt` inventato.
  assert.ok(!/<Image\b/.test(section), 'lo slot vuoto non deve rendere un <Image>')
  assert.ok(!/next\/image/.test(section), 'lo slot vuoto non deve importare next/image')
  assert.ok(!/\bsrc=/.test(section), 'lo slot vuoto non deve avere un src')
  assert.ok(!/\balt=/.test(section), 'nessun alt inventato nel teaser')

  // Il meccanismo dello slot e` quello approvato su /laboratorio (PR #37): div nascosto e
  // invisibile all'albero di accessibilita`, non un segnaposto visivo.
  const slotFn = /function ImageSlot\(\{ slot \}: \{ slot: string \}\) \{\s*return <div data-image-slot=\{slot\} aria-hidden="true" hidden \/>\s*\}/
  assert.match(homeSource, slotFn, 'ImageSlot deve restare il div nascosto approvato, senza contenuto')
})

test('il teaser e` una colonna sola: nessun residuo della griglia a due colonne', () => {
  const section = teaserSection(homeSource)
  assert.ok(!/md:grid-cols-\[1fr_340px\]/.test(section), 'la colonna immagine e` collassata: via la griglia 1fr_340px')
  assert.ok(!/aspect-\[3\/4\]/.test(section), 'via il riquadro 3/4 che ospitava la vecchia immagine')
})
