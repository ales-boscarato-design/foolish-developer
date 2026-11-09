import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Sorgente unica della verifica "lo script `test` esegue davvero tutti i test".
//
// Nasce da un difetto reale: lo script elencava i file uno per uno, quindi
// `src/collections/ordersTrackingEmail.test.ts` (7 test) esisteva ma non veniva eseguito
// ne' in locale ne' in CI, e il check verde non copriva la regressione che quel file
// protegge. La guardia qui sotto confronta i file presenti su disco con quelli
// effettivamente raggiungibili dagli argomenti dello script `test`: un file nuovo che
// nessun argomento seleziona fa fallire `npm run test`, che e' esattamente cio' che
// deve succedere se qualcuno torna a un elenco scritto a mano.

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

/**
 * Converte un glob in RegExp con la sola semantica che serve qui:
 * doppio asterisco piu' slash = zero o piu' segmenti di directory, doppio asterisco =
 * qualunque cosa, asterisco singolo = dentro un segmento, `?` = un carattere.
 * Tutto il resto e' letterale.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = '^'
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1
        if (glob[i + 1] === '/') {
          i += 1
          pattern += '(?:[^/]+/)*'
        } else {
          pattern += '.*'
        }
      } else {
        pattern += '[^/]*'
      }
    } else if (char === '?') {
      pattern += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      pattern += `\\${char}`
    } else {
      pattern += char
    }
  }
  return new RegExp(`${pattern}$`)
}

const FORBIDDEN = ['`', '$(', '|', '&&', '||', ';', '>', '<']

/** Tokenizza lo script come farebbe la shell, rifiutando cio' che non sappiamo leggere. */
export function shellTokens(script: string): string[] {
  for (const forbidden of FORBIDDEN) {
    if (script.includes(forbidden)) {
      throw new Error(`script "test" non analizzabile: contiene "${forbidden}"`)
    }
  }

  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false

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
      started = true
    } else if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
    } else {
      current += char
      started = true
    }
  }

  if (quote) throw new Error('script "test" non analizzabile: virgolette non chiuse')
  if (started) tokens.push(current)
  return tokens
}

/** Flag che filtrano i test: renderli invisibili sarebbe come non eseguirli. */
const FILTERING_FLAGS = ['--test-name-pattern', '--test-skip-pattern', '--test-only']

/** File selezionati dagli argomenti che lo script passa a `tsx --test`. */
export function reachableTestFiles(script: string, onDisk: string[] = listTestFiles()): string[] {
  const tokens = shellTokens(script)
  const index = tokens.indexOf('--test')
  if (index === -1) throw new Error('lo script "test" del CMS non invoca `tsx --test`')

  const selected: string[] = []
  for (const arg of tokens.slice(index + 1)) {
    const flag = arg.split('=')[0]
    if (FILTERING_FLAGS.includes(flag)) {
      throw new Error(`lo script "test" usa ${flag}, che esclude test dall'esecuzione`)
    }
    if (arg.startsWith('-')) continue

    if (arg.includes('*') || arg.includes('?')) {
      const matcher = globToRegExp(arg.replace(/^\.\//, ''))
      selected.push(...onDisk.filter((file) => matcher.test(file)))
    } else {
      const file = arg.replace(/^\.\//, '')
      if (!file.endsWith('.test.ts')) {
        throw new Error(`argomento non riconosciuto nello script "test": ${arg}`)
      }
      selected.push(file)
    }
  }
  return [...new Set(selected)].sort()
}
