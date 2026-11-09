import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Sorgente unica della verifica "lo script `test` esegue davvero tutti i test".
//
// Nasce da un difetto reale: lo script elencava i file uno per uno, quindi
// `src/collections/ordersTrackingEmail.test.ts` (7 test) esisteva ma non veniva eseguito
// ne' in locale ne' in CI, e il check verde non copriva la regressione che quel file
// protegge. La guardia confronta i file presenti su disco con quelli effettivamente
// raggiungibili dagli argomenti dello script `test`: un file nuovo che nessun argomento
// seleziona fa fallire `npm run test`.
//
// Tre trappole sono state misurate, non ipotizzate (review indipendente + prove):
//  - un glob NON quotato lo espande `sh` (senza globstar): `src/**/*.test.ts` diventa
//    `src/*/*.test.ts`, i file piu' profondi non arrivano a node e il test resta verde;
//  - un flag di filtro PRIMA di `--test` (`--test-name-pattern=... --test file`) e'
//    accettato da node ma esclude i test: guardarlo solo dopo `--test` e' cieco;
//  - il `**` del runner non attraversa le directory che iniziano con un punto (ne'
//    `node_modules`), quindi un test in `src/.legacy/` non viene mai eseguito.

/** Radice del pacchetto CMS (questo file vive in `cms/src/lib`). */
export const CMS_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC_ROOT = join(CMS_ROOT, 'src')

/** Tutti i `*.test.ts` sotto `cms/src`, con percorso relativo alla radice del CMS (`/`). */
export function listTestFiles(dir: string = SRC_ROOT, prefix = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      out.push(...listTestFiles(join(dir, entry.name), relative))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(relative)
    }
  }
  return out.sort()
}

/** Un segmento di glob in RegExp. Il primo carattere non puo' essere `.`: il runner salta i dotfile. */
function segmentToRegExp(segment: string): string {
  let out = ''
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i]
    if (char === '*') {
      out += i === 0 ? '[^/.][^/]*' : '[^/]*'
    } else if (char === '?') {
      out += i === 0 ? '[^/.]' : '[^/]'
    } else if ('\\^$.|+()'.includes(char)) {
      out += `\\${char}`
    } else {
      out += char
    }
  }
  return out
}

/**
 * Converte un glob in RegExp con la semantica del runner: `**` come segmento intero
 * attraversa le directory solo se queste non iniziano con un punto, `*` resta dentro un
 * segmento. Graffe e classi di caratteri non sono modellate: il chiamante le rifiuta.
 */
export function globToRegExp(glob: string): RegExp {
  const segments = glob.split('/')
  let pattern = '^'
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1
    if (segment === '**') {
      pattern += last ? '.*' : '(?:[^/.][^/]*/)*'
      return
    }
    pattern += segmentToRegExp(segment)
    if (!last) pattern += '/'
  })
  return new RegExp(`${pattern}$`)
}

const FORBIDDEN = ['`', '$(', '|', '&&', '||', ';', '>', '<']

export type ShellToken = { value: string; quoted: boolean }

/** Tokenizza lo script come farebbe la shell, rifiutando cio' che non sappiamo leggere. */
export function shellTokenList(script: string): ShellToken[] {
  for (const forbidden of FORBIDDEN) {
    if (script.includes(forbidden)) {
      throw new Error(`script "test" non analizzabile: contiene "${forbidden}"`)
    }
  }

  const tokens: ShellToken[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  let quoted = false

  const push = () => {
    tokens.push({ value: current, quoted })
    current = ''
    quoted = false
    started = false
  }

  for (const char of script) {
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      started = true
    } else if (char === '"' || char === "'") {
      quote = char
      quoted = true
      started = true
    } else if (/\s/.test(char)) {
      if (started) push()
    } else {
      current += char
      started = true
    }
  }

  if (quote) throw new Error('script "test" non analizzabile: virgolette non chiuse')
  if (started) push()
  return tokens
}

/** Come `shellTokenList`, senza l'informazione sulle virgolette. */
export function shellTokens(script: string): string[] {
  return shellTokenList(script).map((token) => token.value)
}

/** Flag che filtrano i test: renderli invisibili sarebbe come non eseguirli. */
const FILTERING_FLAGS = ['--test-name-pattern', '--test-skip-pattern', '--test-only']

/** Flag del runner che non cambiano quali file vengono eseguiti. */
const HARMLESS_FLAGS = [
  '--test',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-concurrency',
  '--test-timeout',
  '--test-force-exit',
]

const UNSUPPORTED_GLOB = ['{', '}', '[', ']']

/** File selezionati dagli argomenti che lo script passa a `tsx --test`. */
export function reachableTestFiles(script: string, onDisk: string[] = listTestFiles()): string[] {
  const tokens = shellTokenList(script)
  const index = tokens.findIndex((token) => token.value === '--test')
  if (index === -1) throw new Error('lo script "test" del CMS non invoca `tsx --test`')

  // I flag valgono ovunque nella riga: `--test-name-pattern=x --test file` filtra come
  // se stesse dopo `--test`, e una guardia che guarda solo la coda non lo vede.
  tokens.forEach((token, position) => {
    if (position === 0) return // l'eseguibile (tsx)
    if (!token.value.startsWith('-')) return
    const flag = token.value.split('=')[0]
    if (FILTERING_FLAGS.includes(flag)) {
      throw new Error(`lo script "test" usa ${flag}, che esclude test dall'esecuzione`)
    }
    if (!HARMLESS_FLAGS.includes(flag)) {
      // Fail-closed: un flag nuovo obbliga ad aggiornare questa guardia, invece di
      // scivolare dentro e cambiare in silenzio cosa viene eseguito.
      throw new Error(`lo script "test" usa il flag non riconosciuto ${flag}`)
    }
  })

  const selected: string[] = []
  tokens.slice(index + 1).forEach((token) => {
    if (token.value.startsWith('-')) return

    if (token.value.includes('*') || token.value.includes('?')) {
      for (const unsupported of UNSUPPORTED_GLOB) {
        if (token.value.includes(unsupported)) {
          throw new Error(
            `glob "${token.value}" usa "${unsupported}": non modellato dalla guardia, aggiornala`,
          )
        }
      }
      if (!token.quoted) {
        // Senza virgolette e' `sh` a espandere: senza globstar prende un solo livello,
        // il resto non arriva a node e i test piu' profondi non vengono eseguiti.
        throw new Error(
          `il glob "${token.value}" nello script "test" deve essere tra virgolette: ` +
            "altrimenti lo espande la shell e i test piu' profondi non vengono eseguiti",
        )
      }
      const matcher = globToRegExp(token.value.replace(/^\.\//, ''))
      selected.push(
        ...onDisk.filter(
          (file) => matcher.test(file) && !file.split('/').includes('node_modules'),
        ),
      )
    } else {
      const file = token.value.replace(/^\.\//, '')
      if (!file.endsWith('.test.ts')) {
        throw new Error(`argomento non riconosciuto nello script "test": ${token.value}`)
      }
      selected.push(file)
    }
  })

  return [...new Set(selected)].sort()
}
