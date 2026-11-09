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

test('lo script test non filtra i test per nome', () => {
  for (const flag of ['--test-name-pattern', '--test-skip-pattern', '--test-only']) {
    assert.throws(
      () => reachableTestFiles(`tsx --test ${flag}=foo "src/**/*.test.ts"`),
      new RegExp(flag),
    )
  }
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
  assert.ok(missing.includes('src/lib/order-line-amount.test.ts') === false)
})

test('lo script senza glob non copre un file aggiunto dopo', () => {
  const onDisk = [...listTestFiles(), 'src/lib/nuovo.test.ts'].sort()
  const handwritten = 'tsx --test src/lib/order-line-amount.test.ts'
  const reachable = reachableTestFiles(handwritten, onDisk)
  assert.ok(!reachable.includes('src/lib/nuovo.test.ts'))
})
