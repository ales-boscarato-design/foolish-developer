import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CMS_ROOT,
  EXECUTED_TEST_SUFFIX,
  MIN_EXECUTED_TESTS,
  MIN_NODE_MAJOR,
  TEST_GLOBS,
  assertExecutedTests,
  assertSupportedGlobs,
  assertSupportedTsxArgs,
  coverageMessage,
  coverageReport,
  globToRegExp,
  isExecutedByRunner,
  listTestLikeFiles,
  parseTapCounts,
} from './testScriptCoverage'

// Guardia di copertura del runner dei test del CMS.
//
// `npm run test` e' l'unico passo che esegue i test del CMS in CI. Il difetto che questa
// guardia protegge: un test su disco che nessun argomento dello script seleziona resta
// verde, e la regressione che quel file protegge resta scoperta (e' successo con
// ordersTrackingEmail.test.ts).
//
// Il difetto della PRIMA versione di questa guardia: era essa stessa un `*.test.ts`, quindi
// girava solo se il glob la selezionava. Con il glob rotto `tsx --test` esce 0 con zero
// test e la guardia non veniva eseguita. Ora la guardia e' eseguita anche (a) dal runner
// `scripts/run-tests.ts` prima di lanciare i test, e (b) da un passo CI con path esplicito.

function testScript(): string {
  const pkg = JSON.parse(readFileSync(join(CMS_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
    engines?: { node?: string }
  }
  const script = pkg.scripts?.test
  assert.ok(script, 'package.json del CMS non ha lo script "test"')
  return script
}

function packageEngines(): { node?: string } {
  const pkg = JSON.parse(readFileSync(join(CMS_ROOT, 'package.json'), 'utf8')) as {
    engines?: { node?: string }
  }
  return pkg.engines ?? {}
}

test('lo script "test" del CMS invoca il runner, che e\' l\'unico passo con la guardia', () => {
  // Fail-closed: una forma diversa di script significa che la guardia non gira piu' fuori
  // dal glob, e va deciso qui (e in CI) invece di scoprirlo da un verde.
  assert.equal(
    testScript(),
    'tsx scripts/run-tests.ts',
    'una forma diversa dello script "test" va motivata e registrata qui: e\' il punto in cui la guardia viene eseguita prima dei test',
  )
})

test('il pacchetto CMS dichiara il Node che serve ai glob di node --test', () => {
  const declared = packageEngines().node
  assert.ok(declared, 'package.json del CMS non dichiara engines.node')
  const major = Number(/^>=?\s*(\d+)/.exec(declared)?.[1])
  assert.ok(
    Number.isInteger(major) && major >= MIN_NODE_MAJOR,
    `engines.node "${declared}" non dichiara Node >= ${MIN_NODE_MAJOR}: i glob di \`node --test\` non esistono sotto quella versione`,
  )
})

test('il runner esegue ogni *.test.ts del pacchetto, anche fuori da src', () => {
  const onDisk = listTestLikeFiles()
  assert.ok(onDisk.length > 0, `nessun file ${EXECUTED_TEST_SUFFIX} trovato sotto ${CMS_ROOT}`)

  const report = coverageReport(onDisk)
  assert.deepEqual(
    report.missing,
    [],
    `questi ${EXECUTED_TEST_SUFFIX} non vengono eseguiti dai glob ${TEST_GLOBS.join(' ')}: ${report.missing.join(', ')}`,
  )
  assert.deepEqual(
    report.unsupported,
    [],
    `questi file sembrano test ma non vengono eseguiti: ${report.unsupported.join(', ')}`,
  )

  // La guardia stessa deve essere fra i file eseguiti: se sparisse dal glob, in `npm run
  // test` non girerebbe (la CI la invoca anche per path esplicito, ma il doppio strato e'
  // il punto).
  assert.ok(onDisk.includes('src/lib/testScriptCoverage.test.ts'))
})

test('un test fuori da cms/src e\' coperto: il glob e\' ancorato alla radice del pacchetto', () => {
  assert.equal(isExecutedByRunner('scripts/probe.test.ts'), true)
  assert.deepEqual(coverageReport(['scripts/probe.test.ts']), { unsupported: [], missing: [] })
})

test('un *.spec.ts aggiunto apposta fa rosso la guardia, e viene nominato', () => {
  const report = coverageReport(['src/lib/a.test.ts', 'src/lib/probe.spec.ts'])
  assert.deepEqual(report.unsupported, ['src/lib/probe.spec.ts'])
  assert.deepEqual(report.missing, [])
  const message = coverageMessage(report)
  assert.match(message, /probe\.spec\.ts/)
  assert.match(message, /esegue solo/)
})

test('*.test.tsx e *.test.mjs non sono eseguiti: la guardia lo dice invece di tacerlo', () => {
  const report = coverageReport(['src/ui/a.test.tsx', 'scripts/b.test.mjs', 'src/c.test.ts'])
  assert.deepEqual(report.unsupported, ['scripts/b.test.mjs', 'src/ui/a.test.tsx'])
  assert.deepEqual(report.missing, [])
})

test('un test in una dot-dir non e\' raggiungibile (il ** del runner non la attraversa)', () => {
  const report = coverageReport(['src/lib/a.test.ts', 'src/.legacy/skip.test.ts'])
  assert.deepEqual(report.missing, ['src/.legacy/skip.test.ts'])
  assert.match(coverageMessage(report), /\.legacy\/skip\.test\.ts/)
})

test('listTestLikeFiles censisce tutte le forme di test e salta node_modules', () => {
  const root = mkdtempSync(join(tmpdir(), 'cms-test-guard-'))
  mkdirSync(join(root, 'src', 'lib'), { recursive: true })
  mkdirSync(join(root, 'src', '.legacy'), { recursive: true })
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.test.ts'), '')
  writeFileSync(join(root, 'src', 'lib', 'b.spec.ts'), '')
  writeFileSync(join(root, 'src', 'lib', 'c.test.tsx'), '')
  writeFileSync(join(root, 'src', '.legacy', 'd.test.ts'), '')
  writeFileSync(join(root, 'scripts', 'e.test.mjs'), '')
  writeFileSync(join(root, 'node_modules', 'dep', 'f.test.ts'), '')

  assert.deepEqual(listTestLikeFiles(root), [
    'scripts/e.test.mjs',
    'src/.legacy/d.test.ts',
    'src/a.test.ts',
    'src/lib/b.spec.ts',
    'src/lib/c.test.tsx',
  ])
})

test('globToRegExp: ** attraversa le directory, * no, e nessuno dei due entra nelle dot-dir', () => {
  const recursive = globToRegExp('**/*.test.ts')
  assert.equal(recursive.test('src/lib/order-line-amount.test.ts'), true)
  assert.equal(recursive.test('src/a.test.ts'), true)
  assert.equal(recursive.test('scripts/probe.test.ts'), true)
  assert.equal(recursive.test('src/.legacy/skip.test.ts'), false)
  assert.equal(recursive.test('src/lib/.hidden/skip.test.ts'), false)
  assert.equal(recursive.test('src/lib/a.test.ts.bak'), false)
  assert.equal(recursive.test('src/lib/a.spec.ts'), false)

  const flat = globToRegExp('src/*.test.ts')
  assert.equal(flat.test('src/a.test.ts'), true)
  assert.equal(flat.test('src/lib/a.test.ts'), false)
  assert.equal(flat.test('src/.dot.test.ts'), false)
})

test('un glob con graffe o classi fallisce chiuso invece di dire verde', () => {
  for (const glob of ['**/*.{test,spec}.ts', '**/*.test.[jt]s']) {
    assert.throws(() => assertSupportedGlobs([glob]), /non modellato dalla guardia/)
  }
})

test('il runner non puo\' passare flag che filtrano i test, in nessuna posizione', () => {
  // La forma reale del runner: accettata.
  assert.doesNotThrow(() => assertSupportedTsxArgs(['--test-reporter=tap', '--test', ...TEST_GLOBS]))
  assert.doesNotThrow(() => assertSupportedTsxArgs(['--test', ...TEST_GLOBS]))

  // Un filtro prima di --test verrebbe applicato da node lo stesso.
  for (const flag of ['--test-name-pattern=x', '--test-skip-pattern=x', '--test-only', '-t']) {
    assert.throws(
      () => assertSupportedTsxArgs([flag, '--test', ...TEST_GLOBS]),
      /flag non riconosciuto|escludere test/,
    )
    assert.throws(
      () => assertSupportedTsxArgs(['--test', flag, ...TEST_GLOBS]),
      /puo|possono escludere|flag/,
    )
  }

  assert.throws(() => assertSupportedTsxArgs([...TEST_GLOBS]), /non invoca tsx --test/)
  assert.throws(() => assertSupportedTsxArgs(['--test']), /non passa nessun file/)
})

test('parseTapCounts legge il riepilogo di Node 22 (#) e di Node 26 (i)', () => {
  const tap22 = ['ok 1 - a', '# tests 45', '# pass 45', '# fail 0', '# duration_ms 12'].join('\n')
  assert.deepEqual(parseTapCounts(tap22), { tests: 45, pass: 45, fail: 0 })

  const spec26 = ['✔ a', 'ℹ tests 45', 'ℹ pass 45', 'ℹ fail 0'].join('\n')
  assert.deepEqual(parseTapCounts(spec26), { tests: 45, pass: 45, fail: 0 })

  assert.equal(parseTapCounts('nessun riepilogo qui'), null)

  // Se l'output di un test contiene una riga che sembra un riepilogo, vince l'ultima.
  const noisy = ['ok 1 - x', '# tests 3', 'nota di un test', '# tests 45', '# pass 45', '# fail 0'].join('\n')
  assert.deepEqual(parseTapCounts(noisy), { tests: 45, pass: 45, fail: 0 })
})

test('zero test eseguiti fa fallire il runner (tsx --test esce 0 anche cosi\')', () => {
  assert.throws(
    () => assertExecutedTests({ tests: 0, pass: 0, fail: 0 }),
    /eseguito 0 test/,
  )
  assert.throws(() => assertExecutedTests(null), /riepilogo TAP/)
})

test('meno dei test attesi fa fallire il runner; il conteggio atteso non e\' zero', () => {
  assert.ok(MIN_EXECUTED_TESTS > 0)
  assert.throws(
    () => assertExecutedTests({ tests: MIN_EXECUTED_TESTS - 1, pass: MIN_EXECUTED_TESTS - 1, fail: 0 }),
    /meno dei/,
  )
  assert.throws(
    () => assertExecutedTests({ tests: MIN_EXECUTED_TESTS + 1, pass: MIN_EXECUTED_TESTS, fail: 1 }),
    /falliti/,
  )
  assert.doesNotThrow(() =>
    assertExecutedTests({ tests: MIN_EXECUTED_TESTS, pass: MIN_EXECUTED_TESTS, fail: 0 }),
  )
})

test('la CI esegue la guardia anche col path esplicito, fuori dal glob', () => {
  // Se lo step sparisse, la guardia tornerebbe a dipendere dal glob: e' esattamente il
  // blocker per cui esiste questo file.
  const workflow = readFileSync(
    join(CMS_ROOT, '..', '.github', 'workflows', 'ci.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /tsx --test src\/lib\/testScriptCoverage\.test\.ts/,
    'la CI non invoca la guardia col path esplicito: un glob rotto tornerebbe a essere un verde silenzioso',
  )
})
