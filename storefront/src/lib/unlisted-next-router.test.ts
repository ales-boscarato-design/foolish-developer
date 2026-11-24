import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

const root = process.cwd()

test('Next router applies CMS unlisted checks before the historic master-pack redirect', async (t) => {
  let masterUnlisted = true
  let historicalSuccessor = 'master-pack-20-fogli'

  const requestedSlugs: string[] = []
  const requestedPaths: string[] = []
  const cms = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    requestedPaths.push(url.pathname)
    if (url.pathname === '/api/subscription-plans') {
      const key = url.searchParams.get('where[key][equals]') ?? 'tattoo'
      const plan = {
        key,
        active: true,
        product: {
          id: 1,
          name: 'Fixture subscription product',
          slug: 'fixture-subscription-product',
          unlisted: key === 'tattoo',
          images: [],
          shortDescription: 'Fixture description',
          description: null,
        },
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ docs: [plan] }))
      return
    }
    const slug = url.searchParams.get('where[slug][equals]')
    if (slug) requestedSlugs.push(slug)
    const product = slug === 'master-pack-20-fogli'
      ? { slug, unlisted: masterUnlisted }
      : slug === 'master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl'
        ? { slug, unlisted: true, supersededBy: historicalSuccessor }
      : slug === 'cycle-source'
        ? { slug, unlisted: true, supersededBy: 'master-pack-20-fogli' }
      : slug === 'a'
        ? { slug, unlisted: true, supersededBy: 'new-product' }
        : slug === 'new-product'
          ? { slug, unlisted: false }
        : null
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ docs: product ? [product] : [] }))
  })
  await new Promise<void>((resolve) => cms.listen(0, '127.0.0.1', resolve))
  const cmsPort = (cms.address() as AddressInfo).port
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const appPort = (probe.address() as AddressInfo).port
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()))

  const app: ChildProcess = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(appPort)], {
    cwd: root,
    env: {
      ...process.env,
      PAYLOAD_PUBLIC_URL: `http://127.0.0.1:${cmsPort}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  app.stdout?.on('data', (chunk: Buffer) => { logs += chunk.toString() })
  app.stderr?.on('data', (chunk: Buffer) => { logs += chunk.toString() })
  t.after(async () => {
    app.kill('SIGTERM')
    await new Promise<void>((resolve) => app.once('exit', () => resolve()))
    await new Promise<void>((resolve) => cms.close(() => resolve()))
  })

  const origin = `http://127.0.0.1:${appPort}`
  let ready = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (app.exitCode !== null) break
    try {
      await fetch(`${origin}/it/prodotto/master-pack-20-fogli`, { redirect: 'manual' })
      ready = true
      break
    } catch {
      await delay(500)
    }
  }
  assert.equal(ready, true, `Next dev server did not become ready. Logs:\n${logs}`)

  const unlistedSubscription = await fetch(`${origin}/it/abbonamento/tattoo`)
  assert.equal(unlistedSubscription.status, 200, `unlisted subscription must stay reachable; CMS paths=${requestedPaths.join(',')}; logs=${logs}`)
  assert.equal((await unlistedSubscription.text()).includes('Fixture subscription product'), true)

  const listedSubscription = await fetch(`${origin}/it/abbonamento/pmu`)
  const listedSubscriptionBody = await listedSubscription.text()
  assert.equal(listedSubscription.status, 200, `subscription render failed: ${listedSubscriptionBody.slice(0, 300)}; CMS paths=${requestedPaths.join(',')}; logs=${logs}`)
  assert.equal(listedSubscriptionBody.includes('Fixture subscription product'), true)

  const hidden = await fetch(`${origin}/it/prodotto/master-pack-20-fogli`, { redirect: 'manual' })
  assert.equal(hidden.status, 404)

  masterUnlisted = false
  const listed = await fetch(`${origin}/it/prodotto/master-pack-20-fogli`, { redirect: 'manual' })
  assert.equal(listed.status, 308, 'listed product keeps the historical Next permanent redirect')
  assert.equal(listed.headers.get('location'), 'https://thefoolishbutcher.com/it/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl')

  const supersededLongSlug = await fetch(`${origin}/it/prodotto/master-pack-20-fogli-di-pelle-formato-a5-2-a4-1-xxl`, { redirect: 'manual' })
  assert.equal(supersededLongSlug.status, 404, 'unlisted successor pointing into the historical redirect must not loop')

  historicalSuccessor = 'cycle-source'
  const historicalCycle = await fetch(`${origin}/it/prodotto/cycle-source`, { redirect: 'manual' })
  assert.equal(historicalCycle.status, 404, 'Next proxy must resolve the historical edge before emitting a redirect')
  assert.equal(historicalCycle.headers.get('location'), null)

  const encoded = await fetch(`${origin}/it/prodotto/%61`, { redirect: 'manual' })
  assert.equal(encoded.status, 301, `unexpected encoded-path response; queried slugs=${requestedSlugs.join(',')}; location=${encoded.headers.get('location')}; logs=${logs}`)
  assert.equal(encoded.headers.get('location'), 'https://thefoolishbutcher.com/it/prodotto/new-product')
})
