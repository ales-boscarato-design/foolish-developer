import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CMS_ROOT,
  globToRegExp,
  listTestFiles,
  reachableTestFiles,
  shellTokens,
} from './testScriptCoverage'

// Guardia di copertura: `npm run test` e' l'unico passo che esegue i test del CMS in CI
// (`.github/workflows/ci.yml`, job «CMS — test»). Se un `src/**/*.test.ts` non e'
// raggiungibile dagli argomenti dello script, il check verde non copre quel file e la
// regressione che protegge resta scoperta — e' successo con ordersTrackingEmail.test.ts.

function testScript(): string {
  const pkg = JSON.parse(readFileSync(join(CMS_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const script = pkg.scripts?.test
  assert.ok(script, 'package.json del CMS non ha lo script "test"')
  return script
}

test('lo script test del CMS raggiunge ogni *.test.ts del pacchetto', () => {
  const onDisk = listTestFiles()
  assert.ok(onDisk.length > 0, 'nessun *.test.ts trovato sotto cms/src')

  const reachable = reachableTestFiles(testScript(), onDisk)

  const missing = onDisk.filter((file) => !reachable.includes(file))
  assert.deepEqual(
    missing,
    [],
    `questi file di test non vengono eseguiti da "npm run test": ${missing.join(', ')}`,
  )

  const stale = reachable.filter((file) => !onDisk.includes(file))
  assert.deepEqual(stale, [], `lo script "test" elenca file inesistenti: ${stale.join(', ')}`)
})

test('lo script test non filtra i test per nome, nemmeno prima di --test', () => {
  for (const script of [
    'tsx --test --test-name-pattern=foo "src/**/*.test.ts"',
    'tsx --test --test-skip-pattern=foo "src/**/*.test.ts"',
    'tsx --test --test-only "src/**/*.test.ts"',
    // Il flag vale ovunque nella riga: node lo applica anche scritto prima di --test.
    'tsx --test-name-pattern=foo --test "src/**/*.test.ts"',
    'tsx --test-skip-pattern=foo --test "src/**/*.test.ts"',
  ]) {
    assert.throws(() => reachableTestFiles(script), /esclude test dall'esecuzione/)
  }
})

test('lo script test rifiuta flag non riconosciuti (fail-closed)', () => {
  for (const flag of ['--test-shard=1/2', '-t', '--test-rerun-failures']) {
    assert.throws(
      () => reachableTestFiles(`tsx --test ${flag} "src/**/*.test.ts"`),
      /non riconosciuto/,
    )
  }
  // I flag innocui restano accettati.
  assert.ok(
    reachableTestFiles('tsx --test --test-concurrency=2 "src/**/*.test.ts"').length > 0,
  )
})

test('un glob non quotato e rifiutato: lo espanderebbe la shell, perdendo i livelli profondi', () => {
  // Misurato: `sh` senza globstar espande `src/**/*.test.ts` in `src/*/*.test.ts`, quindi
  // un test a profondita' 3 non arriva mai al runner e `npm run test` esce verde.
  assert.throws(
    () => reachableTestFiles('tsx --test src/**/*.test.ts'),
    /deve essere tra virgolette/,
  )
  assert.ok(reachableTestFiles('tsx --test "src/**/*.test.ts"').length > 0)
})

test('globToRegExp non attraversa dot-dir ne node_modules', () => {
  const glob = globToRegExp('src/**/*.test.ts')
  assert.equal(glob.test('src/lib/a.test.ts'), true)
  assert.equal(glob.test('src/lib/deep/a.test.ts'), true)
  // Il `**` del runner salta queste directory: dichiararle raggiungibili sarebbe un falso verde.
  assert.equal(glob.test('src/.legacy/a.test.ts'), false)
  assert.equal(glob.test('src/lib/.hidden/a.test.ts'), false)
  assert.equal(globToRegExp('src/*.test.ts').test('src/.dot.test.ts'), false)
})

test('un test in una dot-dir non e considerato raggiungibile (guardia rossa, non silenzio)', () => {
  const onDisk = ['src/collections/a.test.ts', 'src/.legacy/skip.test.ts']
  const reachable = reachableTestFiles('tsx --test "src/**/*.test.ts"', onDisk)
  assert.deepEqual(reachable, ['src/collections/a.test.ts'])
})

test('un glob con graffe o classi fallisce chiuso invece di dire verde', () => {
  assert.throws(
    () => reachableTestFiles('tsx --test "src/{lib,collections}/**/*.test.ts"'),
    /non modellato dalla guardia/,
  )
})

test('shellTokens legge virgolette e spazi come la shell', () => {
  assert.deepEqual(shellTokens('tsx --test "src/**/*.test.ts"'), [
    'tsx',
    '--test',
    'src/**/*.test.ts',
  ])
  assert.deepEqual(shellTokens("tsx --test 'src/a.test.ts' src/b.test.ts"), [
    'tsx',
    '--test',
    'src/a.test.ts',
    'src/b.test.ts',
  ])
  assert.throws(() => shellTokens('tsx --test "src/a.test.ts'), /virgolette/)
  assert.throws(() => shellTokens('tsx --test $(find src)'), /non analizzabile/)
  assert.throws(() => shellTokens('tsx --test "src/*.test.ts" | tee log'), /non analizzabile/)
})

test('globToRegExp: ** attraversa le directory, * no', () => {
  const recursive = globToRegExp('src/**/*.test.ts')
  assert.equal(recursive.test('src/lib/order-line-amount.test.ts'), true)
  assert.equal(recursive.test('src/collections/mediaAccess.test.ts'), true)
  assert.equal(recursive.test('src/lib/deeper/nested.test.ts'), true)
  assert.equal(recursive.test('src/a.test.ts'), true)
  assert.equal(recursive.test('scripts/a.test.ts'), false)
  assert.equal(recursive.test('src/lib/a.test.ts.bak'), false)

  const flat = globToRegExp('src/*.test.ts')
  assert.equal(flat.test('src/a.test.ts'), true)
  assert.equal(flat.test('src/lib/a.test.ts'), false)
})

test('un file nuovo fuori dall elenco scritto a mano fa fallire la guardia', () => {
  const onDisk = listTestFiles()
  const handwritten =
    'tsx --test src/lib/order-line-amount.test.ts src/collections/mediaAccess.test.ts'
  const reachable = reachableTestFiles(handwritten, onDisk)
  const missing = onDisk.filter((file) => !reachable.includes(file))
  assert.ok(missing.length > 0, 'la guardia deve accorgersi dei file non elencati')
  assert.equal(missing.includes('src/lib/order-line-amount.test.ts'), false)
})

test('lo script senza glob non copre un file aggiunto dopo', () => {
  const onDisk = [...listTestFiles(), 'src/lib/nuovo.test.ts'].sort()
  const handwritten = 'tsx --test src/lib/order-line-amount.test.ts'
  const reachable = reachableTestFiles(handwritten, onDisk)
  assert.ok(!reachable.includes('src/lib/nuovo.test.ts'))
})
