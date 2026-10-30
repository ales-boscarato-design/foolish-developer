import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/**
 * Behavioural tests for the real service worker in public/sw.js.
 *
 * The worker is executed in a vm with a small in-memory Cache API and a
 * synthetic fetch. Assertions check what a user would receive (response body,
 * cache keys) rather than the shape of the source.
 */

const SW_PATH = fileURLToPath(new URL('../../public/sw.js', import.meta.url))
const OFFLINE_PATH = fileURLToPath(new URL('../../public/offline.html', import.meta.url))
const SW_SOURCE = readFileSync(SW_PATH, 'utf8')
const OFFLINE_HTML = readFileSync(OFFLINE_PATH, 'utf8')

const ORIGIN = 'https://foolish.test'
const CACHE_NAME = 'foolish-pwa-v2'
const PRECACHE_URLS = ['/offline.html', '/icon-192.png', '/icon-512.png']

interface FakeRequest {
  url: string
  mode?: string
}

type RequestInput = string | FakeRequest

type FetchHandler = (request: FakeRequest) => Response | Promise<Response>

interface StoredResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
}

function pathOf(input: RequestInput): string {
  const raw = typeof input === 'string' ? input : input.url
  const url = new URL(raw, ORIGIN)
  return `${url.pathname}${url.search}`
}

function absolute(input: RequestInput): string {
  return new URL(typeof input === 'string' ? input : input.url, ORIGIN).toString()
}

async function snapshot(response: Response): Promise<StoredResponse> {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: await response.text(),
  }
}

function materialize(entry: StoredResponse): Response {
  return new Response(entry.body, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  })
}

type SyntheticFetch = (input: RequestInput) => Promise<Response>

/** Cache with the real constraints that matter here: addAll rejects if any response is not ok. */
class MemoryCache {
  readonly entries = new Map<string, StoredResponse>()

  constructor(private readonly fetchImpl: SyntheticFetch) {}

  async match(request: RequestInput): Promise<Response | undefined> {
    const entry = this.entries.get(pathOf(request))
    return entry ? materialize(entry) : undefined
  }

  async addAll(requests: RequestInput[]): Promise<void> {
    const pending: Array<[string, StoredResponse]> = []
    const seen = new Set<string>()
    for (const request of requests) {
      const key = pathOf(request)
      if (seen.has(key) || this.entries.has(key)) throw new TypeError(`addAll duplicate request: ${key}`)
      seen.add(key)
      const response = await this.fetchImpl(request)
      if (!response.ok) throw new TypeError(`addAll failed for ${key} status=${response.status}`)
      pending.push([key, await snapshot(response)])
    }
    // addAll is atomic: nothing is stored unless every response is usable.
    for (const [key, entry] of pending) this.entries.set(key, entry)
  }

  async add(request: RequestInput): Promise<void> {
    const response = await this.fetchImpl(request)
    if (!response.ok) throw new TypeError(`add failed for ${pathOf(request)} status=${response.status}`)
    this.entries.set(pathOf(request), await snapshot(response))
  }

  async put(request: RequestInput, response: Response): Promise<void> {
    this.entries.set(pathOf(request), await snapshot(response))
  }

  async keys(): Promise<string[]> {
    return [...this.entries.keys()]
  }

  async delete(request: RequestInput): Promise<boolean> {
    return this.entries.delete(pathOf(request))
  }
}

class MemoryCacheStorage {
  readonly caches = new Map<string, MemoryCache>()

  constructor(private readonly fetchImpl: SyntheticFetch) {}

  async open(name: string): Promise<MemoryCache> {
    let cache = this.caches.get(name)
    if (!cache) {
      cache = new MemoryCache(this.fetchImpl)
      this.caches.set(name, cache)
    }
    return cache
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()]
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name)
  }

  async has(name: string): Promise<boolean> {
    return this.caches.has(name)
  }

  async match(request: RequestInput): Promise<Response | undefined> {
    for (const cache of this.caches.values()) {
      const found = await cache.match(request)
      if (found) return found
    }
    return undefined
  }

  names(): string[] {
    return [...this.caches.keys()]
  }

  entriesOf(name: string): string[] {
    const cache = this.caches.get(name)
    return cache ? [...cache.entries.keys()] : []
  }

  cache(name: string): MemoryCache | undefined {
    return this.caches.get(name)
  }

  async bodiesOfAppCaches(): Promise<string[]> {
    const bodies: string[] = []
    for (const [name, cache] of this.caches) {
      if (!name.startsWith('foolish-pwa-')) continue
      for (const key of cache.entries.keys()) {
        const response = await cache.match(key)
        if (response) bodies.push(await response.text())
      }
    }
    return bodies
  }
}

interface SwEvent {
  waitUntil(promise: Promise<unknown>): void
  respondWith(promise: Promise<Response>): void
  [key: string]: unknown
}

type SwListener = (event: SwEvent) => void

interface FakeWindowClient {
  url: string
  navigate: (url: string) => void
  focus: () => Promise<void>
}

interface HarnessOptions {
  fetch: FetchHandler
  windows?: FakeWindowClient[]
}

interface NotificationRecord {
  title: string
  options: Record<string, unknown>
}

interface Harness {
  caches: MemoryCacheStorage
  fetchCalls: string[]
  dispatch(type: string, props?: Record<string, unknown>): {
    settle(): Promise<unknown[]>
    response(): Promise<Response>
    hasResponse(): boolean
  }
  notifications: NotificationRecord[]
  opened: string[]
  navigated: string[]
  focused: string[]
}

function makeFetch(handler: FetchHandler): { fetch: SyntheticFetch; calls: string[] } {
  const calls: string[] = []
  async function fetchImpl(input: RequestInput): Promise<Response> {
    calls.push(pathOf(input))
    const request: FakeRequest =
      typeof input === 'string'
        ? { url: absolute(input), mode: 'no-cors' }
        : input
    return handler(request)
  }
  return { fetch: fetchImpl, calls }
}

function createHarness(options: HarnessOptions): Harness {
  const listeners = new Map<string, SwListener[]>()
  const fetchState = makeFetch(options.fetch)
  const cacheStorage = new MemoryCacheStorage(fetchState.fetch)
  const notifications: NotificationRecord[] = []
  const opened: string[] = []
  const navigated: string[] = []
  const focused: string[] = []
  const windows = options.windows ?? []

  const clientsApi = {
    claim: async () => undefined,
    matchAll: async () => windows,
    openWindow: async (url: string) => {
      opened.push(url)
      return null
    },
  }

  const self = {
    addEventListener(type: string, listener: SwListener) {
      const registered = listeners.get(type) ?? []
      registered.push(listener)
      listeners.set(type, registered)
    },
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title: string, notificationOptions: Record<string, unknown>) => {
        notifications.push({ title, options: notificationOptions })
      },
    },
    clients: clientsApi,
  }

  const context = vm.createContext({
    self,
    caches: cacheStorage,
    fetch: fetchState.fetch,
    clients: clientsApi,
    Response,
    Request,
    Headers,
    URL,
    console,
  })
  vm.runInContext(SW_SOURCE, context, { filename: SW_PATH })

  return {
    caches: cacheStorage,
    fetchCalls: fetchState.calls,
    notifications,
    opened,
    navigated,
    focused,
    dispatch(type, props = {}) {
      const registered = listeners.get(type) ?? []
      assert.ok(registered.length > 0, `no '${type}' listener registered by the service worker`)
      const waits: Promise<unknown>[] = []
      let response: Promise<Response> | undefined
      const event: SwEvent = {
        ...props,
        waitUntil(promise) {
          waits.push(Promise.resolve(promise))
        },
        respondWith(promise) {
          response = Promise.resolve(promise)
        },
      }
      for (const listener of registered) listener(event)
      return {
        settle: () => Promise.all(waits),
        response: () => {
          assert.ok(response, `'${type}' did not call respondWith`)
          return response
        },
        hasResponse: () => response !== undefined,
      }
    },
  }
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function redirect(location: string): Response {
  return new Response(null, { status: 307, headers: { Location: location } })
}

function staticAsset(request: FakeRequest): Response {
  const path = pathOf(request)
  if (path === '/offline.html') return html(OFFLINE_HTML)
  if (path === '/icon-192.png' || path === '/icon-512.png') return new Response('icon', { status: 200 })
  return html(`unexpected ${path}`, 404)
}

async function install(harness: Harness): Promise<void> {
  await harness.dispatch('install').settle()
}

function navigate(path: string): FakeRequest {
  return { url: `${ORIGIN}${path}`, mode: 'navigate' }
}

function assertOnlyStaticPrecache(harness: Harness): void {
  assert.deepEqual(harness.caches.entriesOf(CACHE_NAME).sort(), [...PRECACHE_URLS].sort())
  for (const key of harness.caches.entriesOf(CACHE_NAME)) {
    assert.ok(!key.startsWith('/account'), `personal page found in precache: ${key}`)
  }
}

/**
 * The worker may only keep the static precache, under CACHE_NAME and no other
 * app cache: checking just CACHE_NAME would miss a page written under a new
 * name (e.g. 'foolish-pwa-pagine').
 */
async function assertOnlyStaticAssetsInEveryAppCache(harness: Harness): Promise<void> {
  // Cache writes triggered by the response may not be awaited by the worker.
  await new Promise<void>((resolve) => setImmediate(resolve))

  const appCacheNames = harness.caches.names().filter((name) => name.startsWith('foolish-pwa-'))
  for (const name of appCacheNames) {
    for (const key of harness.caches.entriesOf(name)) {
      assert.ok(
        PRECACHE_URLS.includes(key),
        `unexpected cache entry '${key}' found in app cache '${name}'`,
      )
    }
  }

  assert.deepEqual(
    [...appCacheNames].sort(),
    [CACHE_NAME],
    `unexpected app cache(s) besides ${CACHE_NAME}: ${appCacheNames.filter((name) => name !== CACHE_NAME).join(', ')}`,
  )
}

test('install succeeds for an unauthenticated visitor and never precaches a redirecting page', async () => {
  const harness = createHarness({
    fetch: (request) => {
      const path = pathOf(request)
      if (path === '/account' || path === '/account/login') return redirect(path)
      return staticAsset(request)
    },
  })

  await install(harness)

  assertOnlyStaticPrecache(harness)
  assert.deepEqual(harness.caches.names(), [CACHE_NAME])
  assert.ok(!harness.fetchCalls.includes('/account'), 'install must not request /account')
  assert.ok(!harness.fetchCalls.includes('/account/login'), 'install must not request /account/login')
})

test('a logged-in install still caches only static assets, never account pages', async () => {
  const harness = createHarness({
    fetch: (request) => {
      const path = pathOf(request)
      if (path === '/account') return html('UTENTE-A pagina personale')
      if (path === '/account/login') return html('UTENTE-A login')
      return staticAsset(request)
    },
  })

  await install(harness)

  assertOnlyStaticPrecache(harness)
})

test('offline navigations always get the neutral static page, even after /account was served online', async () => {
  let online = true
  const harness = createHarness({
    fetch: (request) => {
      const path = pathOf(request)
      if (PRECACHE_URLS.includes(path)) return staticAsset(request)
      if (!online) return Promise.reject(new TypeError('offline'))
      if (path === '/account') return html('UTENTE-A dati personali')
      return html(`pagina online ${path}`)
    },
  })

  await install(harness)

  const onlineNavigation = harness.dispatch('fetch', { request: navigate('/account') })
  const onlineResponse = await onlineNavigation.response()
  assert.match(await onlineResponse.text(), /UTENTE-A/)
  // Network-first: the personal navigation response was not stored, in the
  // current cache or under any other 'foolish-pwa-*' name.
  assertOnlyStaticPrecache(harness)
  await assertOnlyStaticAssetsInEveryAppCache(harness)

  online = false
  const orders = harness.dispatch('fetch', { request: navigate('/it/ordini') })
  const ordersBody = await (await orders.response()).text()
  const checkout = harness.dispatch('fetch', { request: navigate('/it/checkout') })
  const checkoutBody = await (await checkout.response()).text()

  assert.equal(ordersBody, OFFLINE_HTML)
  assert.equal(checkoutBody, OFFLINE_HTML)
  assert.equal(ordersBody, checkoutBody)
  assert.ok(!ordersBody.includes('UTENTE-A'))
})

test('purging on logout removes user A data; user B then sees only the neutral offline page', async () => {
  let online = true
  const harness = createHarness({
    fetch: (request) => {
      const path = pathOf(request)
      if (PRECACHE_URLS.includes(path)) return staticAsset(request)
      if (!online) return Promise.reject(new TypeError('offline'))
      if (path === '/account') return html('UTENTE-A pagina personale')
      return html(`pagina online ${path}`)
    },
  })

  await install(harness)

  // A stale personal entry, as the old worker would have left behind.
  const currentCache = await harness.caches.open(CACHE_NAME)
  await currentCache.put('/account', html('UTENTE-A pagina personale'))
  await currentCache.put('/it/ordini', html('UTENTE-A ordini personali'))

  // User A navigates online; the page is personal but nothing new is cached.
  const aNavigation = harness.dispatch('fetch', { request: navigate('/account') })
  assert.match(await (await aNavigation.response()).text(), /UTENTE-A/)

  // Logout sends the purge message to the worker.
  const purge = harness.dispatch('message', {
    data: { type: 'foolish:purge-personal-cache' },
  })
  await purge.settle()

  assertOnlyStaticPrecache(harness)
  const cachedBodies = await harness.caches.bodiesOfAppCaches()
  assert.ok(!cachedBodies.some((body) => body.includes('UTENTE-A')), 'user A data survived the purge')

  // User B on the same device goes offline on another page.
  online = false
  const bNavigation = harness.dispatch('fetch', { request: navigate('/it/ordini') })
  const bBody = await (await bNavigation.response()).text()

  assert.equal(bBody, OFFLINE_HTML)
  assert.ok(!bBody.includes('UTENTE-A'))
  assert.ok(!bBody.includes('UTENTE-B'))
})

test('activate deletes the old app cache but keeps the current one and other apps caches', async () => {
  const harness = createHarness({ fetch: staticAsset })
  await install(harness)

  const oldCache = await harness.caches.open('foolish-pwa-v1')
  await oldCache.put('/account', html('UTENTE-A vecchia cache'))
  const otherCache = await harness.caches.open('altra-app-cache')
  await otherCache.put('/keep', html('da conservare'))

  await harness.dispatch('activate').settle()

  const names = harness.caches.names()
  assert.ok(!names.includes('foolish-pwa-v1'), 'the v1 cache must be deleted')
  assert.ok(names.includes(CACHE_NAME), 'the current cache must survive')
  assert.ok(names.includes('altra-app-cache'), 'caches of other apps must not be touched')
  assert.deepEqual(harness.caches.entriesOf('altra-app-cache'), ['/keep'])
  assertOnlyStaticPrecache(harness)
})

test('push shows the expected notification and notificationclick focuses or opens the URL', async () => {
  const noWindow = createHarness({ fetch: staticAsset })
  await noWindow.dispatch('push', {
    data: { json: () => ({ title: 'Ordine pronto', body: 'Il tuo ordine è pronto', url: '/it/ordini/42' }) },
  }).settle()

  assert.equal(noWindow.notifications.length, 1)
  assert.equal(noWindow.notifications[0].title, 'Ordine pronto')
  assert.equal(noWindow.notifications[0].options.body, 'Il tuo ordine è pronto')
  assert.equal(noWindow.notifications[0].options.icon, '/icon-192.png')
  assert.equal(noWindow.notifications[0].options.badge, '/icon-192.png')

  let closed = 0
  await noWindow.dispatch('notificationclick', {
    notification: {
      close: () => { closed += 1 },
      data: { url: '/it/ordini/42' },
    },
  }).settle()

  assert.equal(closed, 1)
  assert.deepEqual(noWindow.opened, ['/it/ordini/42'])

  const target = '/it/ordini/99'
  const navigated: string[] = []
  const focused: string[] = []
  const windowClient: FakeWindowClient = {
    url: `${ORIGIN}/account`,
    navigate: (url) => { navigated.push(url) },
    focus: async () => { focused.push('focused') },
  }
  const withWindow = createHarness({ fetch: staticAsset, windows: [windowClient] })
  await withWindow.dispatch('notificationclick', {
    notification: {
      close: () => undefined,
      data: { url: target },
    },
  }).settle()

  assert.deepEqual(navigated, [target])
  assert.deepEqual(focused, ['focused'])
  assert.deepEqual(withWindow.opened, [])
})

test('an online navigation uses the network without writing cache; non-navigation requests are untouched', async () => {
  const harness = createHarness({
    fetch: (request) => {
      const path = pathOf(request)
      if (PRECACHE_URLS.includes(path)) return staticAsset(request)
      return html(`RETE ${path}`)
    },
  })
  await install(harness)
  const callsAfterInstall = harness.fetchCalls.length

  const navigation = harness.dispatch('fetch', { request: navigate('/it/prodotti') })
  const response = await navigation.response()
  assert.equal(response.status, 200)
  assert.match(await response.text(), /RETE \/it\/prodotti/)
  assert.equal(harness.fetchCalls.length, callsAfterInstall + 1)
  assertOnlyStaticPrecache(harness)
  await assertOnlyStaticAssetsInEveryAppCache(harness)

  const apiRequest = harness.dispatch('fetch', {
    request: { url: `${ORIGIN}/api/account/profile`, mode: 'cors' },
  })
  assert.equal(apiRequest.hasResponse(), false, 'non-navigation requests must not be intercepted')
  assert.equal(harness.fetchCalls.length, callsAfterInstall + 1)
})

test('a missing offline.html produces an inline 503 emergency response', async () => {
  const harness = createHarness({
    fetch: () => Promise.reject(new TypeError('offline')),
  })

  const navigation = harness.dispatch('fetch', { request: navigate('/it/ordini') })
  const response = await navigation.response()

  assert.equal(response.status, 503)
  const body = await response.text()
  assert.match(body, /Sei offline/)
  assert.match(body, /You are offline/)
  assert.ok(!body.includes('UTENTE-A'))
})
