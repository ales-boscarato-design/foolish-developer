import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Sorgente unica della verifica "lo script `test` esegue davvero tutti i test del CMS".
//
// Nasce da un difetto reale: lo script elencava i file uno per uno, quindi
// `src/collections/ordersTrackingEmail.test.ts` (7 test) esisteva ma non veniva eseguito
// ne' in locale ne' in CI, e il check verde non copriva la regressione che quel file
// protegge.
//
// Un secondo difetto, trovato in review sulla prima versione di questa guardia: la guardia
// era essa stessa un `*.test.ts`, quindi veniva eseguita **solo dai file che il glob
// selezionava**. Con un glob rotto `tsx --test` esce 0 con zero test e la guardia non gira
// mai: un verde silenzioso al posto di un rosso. Per questo la guardia ora vive in due
// punti che non dipendono dal glob:
//  1. dentro `scripts/run-tests.ts`, che e' il comando lanciato da `npm run test`: prima di
//     eseguire i test confronta i file su disco con quelli raggiungibili dai glob;
//  2. in un passo CI dedicato che invoca `src/lib/testScriptCoverage.test.ts` **per path
//     esplicito** (`./node_modules/.bin/tsx --test src/lib/testScriptCoverage.test.ts`).
//
// Misurato, non ipotizzato (Node 22.23.4 e Node 26.13.0):
//  - `tsx --test "src/**/*.test.ts"` con un glob che non seleziona nulla esce **0** con
//    `# tests 0`: il glob rotto non produce alcun errore;
//  - i glob di `node --test` esistono da Node 22 (sotto, `Could not find`), e il `**` non
//    attraversa le directory che iniziano con un punto ne' `node_modules`;
//  - i glob arrivano a node come **array di argomenti** (nessuna shell): la trappola del
//    glob non quotato, espanso da `sh` a un solo livello, qui non esiste per costruzione.

/** Radice del pacchetto CMS (questo file vive in `cms/src/lib`). */
export const CMS_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Gli unici glob che il runner passa a `tsx --test`, ancorati alla radice del CMS: ogni
 * `*.test.ts` del pacchetto viene eseguito, anche fuori da `src/`.
 */
export const TEST_GLOBS: readonly string[] = ['**/*.test.ts']

/** L'unica forma di test eseguita. Qualunque altra fa rosso invece di sparire. */
export const EXECUTED_TEST_SUFFIX = '.test.ts'

/**
 * Nome che *sembra* un test: se non e' `*.test.ts` il runner non lo esegue, quindi la
 * guardia lo nomina invece di dichiararlo coperto.
 */
const TEST_LIKE = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/

/** Directory che non contengono codice nostro: non si scansionano. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', '.next'])

/** Sotto questa major i glob di `node --test` non esistono: il runner si ferma. */
export const MIN_NODE_MAJOR = 22

/**
 * Ogni file che sembra un test sotto `cms/`, con percorso relativo alla radice del CMS.
 *
 * Le dot-dir **non** vengono saltate: un `*.test.ts` dentro `src/.legacy/` non e'
 * raggiungibile dal glob (il `**` del runner salta le cartelle che iniziano con un punto),
 * e dichiararlo raggiungibile sarebbe un falso verde. Viene listato e poi segnalato come
 * non eseguito.
 */
export function listTestLikeFiles(root: string = CMS_ROOT, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      out.push(...listTestLikeFiles(join(root, entry.name), relative))
    } else if (entry.isFile() && TEST_LIKE.test(entry.name)) {
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

/** Graffe e classi di caratteri hanno semantica che questa guardia non modella. */
const UNSUPPORTED_GLOB = ['{', '}', '[', ']']

export function assertSupportedGlobs(globs: readonly string[]): void {
  for (const glob of globs) {
    for (const unsupported of UNSUPPORTED_GLOB) {
      if (glob.includes(unsupported)) {
        throw new Error(
          `glob "${glob}" usa "${unsupported}": non modellato dalla guardia, aggiornala`,
        )
      }
    }
  }
}

/** Flag di `tsx`/node ammessi **prima** di `--test`: non cambiano quali file vengono eseguiti. */
const HARMLESS_PRE_ARGS = ['--test-reporter', '--test-reporter-destination']

/**
 * Valida gli argomenti che il runner passa a `tsx`, come lista e non come stringa: cosi'
 * un flag che filtra i test (`--test-name-pattern`, `--test-skip-pattern`, `--test-only`)
 * non puo' scivolare dentro, in nessuna posizione.
 */
export function assertSupportedTsxArgs(args: readonly string[]): void {
  const index = args.indexOf('--test')
  if (index === -1) throw new Error('il runner dei test non invoca tsx --test')
  if (index !== args.lastIndexOf('--test')) {
    throw new Error('il runner dei test passa --test piu\' di una volta')
  }

  for (const arg of args.slice(0, index)) {
    const flag = arg.split('=')[0]
    if (!HARMLESS_PRE_ARGS.includes(flag)) {
      throw new Error(
        `il runner dei test passa a tsx il flag non riconosciuto ${flag}: ` +
          'puo\' cambiare quali test vengono eseguiti, quindi va deciso qui',
      )
    }
  }

  const globs = args.slice(index + 1)
  if (globs.length === 0) throw new Error('il runner dei test non passa nessun file a tsx --test')
  for (const glob of globs) {
    if (glob.startsWith('-')) {
      throw new Error(
        `il runner dei test passa "${glob}" come file a --test: i flag dopo --test ` +
          'possono escludere test dall\'esecuzione',
      )
    }
  }
  assertSupportedGlobs(globs)
}

/** Un file e' raggiungibile dai glob del runner? */
export function isExecutedByRunner(file: string, globs: readonly string[] = TEST_GLOBS): boolean {
  return globs.some((glob) => globToRegExp(glob).test(file))
}

export type CoverageReport = {
  /** File che sembrano test ma non hanno la forma eseguita (`*.test.ts`). */
  unsupported: string[]
  /** `*.test.ts` che i glob del runner non selezionano. */
  missing: string[]
}

/**
 * Confronta i file presenti con quelli che il runner esegue. `unsupported` e `missing`
 * vuoti = ogni test e' coperto.
 */
export function coverageReport(
  onDisk: readonly string[],
  globs: readonly string[] = TEST_GLOBS,
): CoverageReport {
  assertSupportedGlobs(globs)
  const unsupported = onDisk
    .filter((file) => !file.endsWith(EXECUTED_TEST_SUFFIX))
    .sort()
  const missing = onDisk
    .filter((file) => file.endsWith(EXECUTED_TEST_SUFFIX))
    .filter((file) => !isExecutedByRunner(file, globs))
    .sort()
  return { unsupported, missing }
}

/** Messaggio unico di errore: dice cosa non va e quali file sono coinvolti. */
export function coverageMessage(report: CoverageReport): string {
  const lines = ['la guardia dei test del CMS e\' rossa:']
  if (report.unsupported.length > 0) {
    lines.push(
      `  - sembrano test ma il runner esegue solo "${EXECUTED_TEST_SUFFIX}": ` +
        `${report.unsupported.join(', ')}` +
        '\n    (rinominali, oppure estendi i glob del runner e questa guardia: la scelta va fatta, non subita)',
    )
  }
  if (report.missing.length > 0) {
    lines.push(
      `  - ${EXECUTED_TEST_SUFFIX} non eseguiti dai glob ${TEST_GLOBS.join(' ')} ` +
        `(glob rotto, o file in una dot-dir che il runner non attraversa): ${report.missing.join(', ')}`,
    )
  }
  return lines.join('\n')
}

export type TestCounts = { tests: number; pass: number; fail: number }

/**
 * Riepilogo dal reporter TAP di `node --test`. Accetta sia `# tests 45` (reporter TAP, e
 * Node 22) sia `ℹ tests 45` (reporter spec di Node 26), cosi' la lettura non dipende dal
 * Node che esegue i test.
 */
export function parseTapCounts(output: string): TestCounts | null {
  const read = (label: 'tests' | 'pass' | 'fail'): number | null => {
    // L'ultima occorrenza: l'output di un test puo' contenere una riga che sembra un
    // riepilogo, il riepilogo vero e' l'ultimo che il runner stampa.
    const matches = [
      ...output.matchAll(new RegExp(`^\\s*(?:#|ℹ)\\s*${label}\\s+(\\d+)\\s*$`, 'gm')),
    ]
    const last = matches.at(-1)
    return last ? Number(last[1]) : null
  }
  const tests = read('tests')
  const pass = read('pass')
  const fail = read('fail')
  if (tests === null || pass === null || fail === null) return null
  return { tests, pass, fail }
}

/**
 * Numero minimo di test eseguiti. Puo' solo crescere: se scende, dei test sono spariti o
 * sono stati filtrati, e il calo va visto prima del merge. Alzarlo e' normale quando si
 * aggiungono test; abbassarlo richiede una modifica esplicita con il perche' nel commit.
 */
export const MIN_EXECUTED_TESTS = 49

/** `tsx --test` esce 0 anche con zero test eseguiti: l'unica prova e' il conteggio. */
export function assertExecutedTests(counts: TestCounts | null): void {
  if (counts === null) {
    throw new Error(
      'il runner non ha prodotto un riepilogo TAP (# tests N): impossibile dire quanti test siano stati eseguiti',
    )
  }
  if (counts.tests === 0) {
    throw new Error(
      'il runner ha eseguito 0 test: il glob non seleziona nessun file (tsx --test esce 0 anche in questo caso)',
    )
  }
  if (counts.tests < MIN_EXECUTED_TESTS) {
    throw new Error(
      `il runner ha eseguito ${counts.tests} test, meno dei ${MIN_EXECUTED_TESTS} attesi: ` +
        'dei test sono spariti, non sono raggiunti dal glob o sono stati filtrati',
    )
  }
  if (counts.fail > 0) {
    throw new Error(`il runner ha ${counts.fail} test falliti`)
  }
  if (counts.pass === 0) {
    throw new Error('il runner non ha nessun test passato')
  }
}
