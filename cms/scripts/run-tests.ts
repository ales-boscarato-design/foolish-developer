// Esecutore dei test del CMS: e' il comando lanciato da `npm run test`, quindi l'unico
// passo che in CI (job «Gate, test e build», step «CMS — test») esegue i test del
// pacchetto.
//
// Perche' non basta `tsx --test "<glob>"` in package.json (era la versione precedente):
// `tsx --test` esce **0** anche quando i glob non selezionano nessun file, con `# tests 0`.
// Un glob rotto — path sbagliato, estensione sbagliata, zero match — produceva quindi un
// verde silenzioso, e la guardia di copertura (che vive in `src/lib/testScriptCoverage.ts`
// ed e' essa stessa un `*.test.ts`) non veniva eseguita affatto. Misurato su Node 22.23.4 e
// Node 26.13.0.
//
// Questo runner chiude quel buco con due controlli che NON dipendono dal glob:
//  1. prima di eseguire: confronta i file di test su disco con quelli raggiungibili dai
//     glob (guardia di copertura, eseguita qui fuori dal glob);
//  2. dopo aver eseguito: legge il riepilogo TAP e pretende `tests > 0`, almeno
//     `MIN_EXECUTED_TESTS` test e zero falliti. Il conteggio e' l'unica prova che i test
//     siano stati davvero eseguiti.
//
// Gli argomenti passano a `tsx` come array: nessuna shell, quindi nessun glob espanso a
// meta' e nessun flag che possa cambiare in silenzio cosa viene eseguito (validato da
// `assertSupportedTsxArgs`).

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CMS_ROOT,
  EXECUTED_TEST_SUFFIX,
  MIN_NODE_MAJOR,
  TEST_GLOBS,
  assertExecutedTests,
  assertSupportedTsxArgs,
  coverageMessage,
  coverageReport,
  listTestLikeFiles,
  parseTapCounts,
} from '../src/lib/testScriptCoverage'

const nodeMajor = Number(process.versions.node.split('.')[0])
if (!Number.isInteger(nodeMajor) || nodeMajor < MIN_NODE_MAJOR) {
  console.error(
    `il runner dei test del CMS richiede Node >= ${MIN_NODE_MAJOR}: i glob di \`node --test\` ` +
      `esistono da quella versione. Qui gira Node ${process.versions.node}.`,
  )
  process.exit(1)
}

// 1. Guardia di copertura, prima di eseguire: se un test non e' raggiungibile, i test che
//    stiamo per eseguire non sono tutti quelli che ci sono.
const onDisk = listTestLikeFiles()
const report = coverageReport(onDisk)
if (report.unsupported.length > 0 || report.missing.length > 0) {
  console.error(coverageMessage(report))
  process.exit(1)
}

const executedFiles = onDisk.filter((file) => file.endsWith(EXECUTED_TEST_SUFFIX))
console.log(
  `[cms test] guardia ok: ${executedFiles.length} file ${EXECUTED_TEST_SUFFIX} coperti da ` +
    `${TEST_GLOBS.join(' ')}; eseguo i test con Node ${process.versions.node}`,
)

// 2. Esecuzione. `--test-reporter=tap` da' un riepilogo (`# tests N`) stabile fra le
//    versioni di Node, cosi' il conteggio non dipende dal reporter predefinito.
const tsxBin = join(CMS_ROOT, 'node_modules', '.bin', 'tsx')
const args = ['--test-reporter=tap', '--test', ...TEST_GLOBS]
assertSupportedTsxArgs(args)

const result = spawnSync(existsSync(tsxBin) ? tsxBin : 'tsx', args, {
  cwd: CMS_ROOT,
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 64 * 1024 * 1024,
})

if (result.error) {
  console.error(`impossibile eseguire tsx: ${result.error.message}`)
  process.exit(1)
}

const stdout = result.stdout ?? ''
process.stdout.write(stdout)
process.stderr.write(result.stderr ?? '')

// 3. La prova che i test siano stati eseguiti davvero.
try {
  assertExecutedTests(parseTapCounts(stdout))
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
