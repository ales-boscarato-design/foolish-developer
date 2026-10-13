import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalLegacyPath, legacyRedirectUrl } from './legacy-slugs'

// L'URL della richiesta come lo vede il container dietro il proxy di Railway:
// indirizzo interno e porta 8080, che non devono mai finire nel `Location`.
const PROD_REQUEST = new URL('http://0.0.0.0:8080/es/prodotto/t-sheet-dbl%20-%20abbonamento')

test('dirotta lo slug malformato codificato (%20) verso quello canonico', () => {
  assert.equal(
    canonicalLegacyPath('/es/prodotto/t-sheet-dbl%20-%20abbonamento'),
    '/es/prodotto/t-sheet-dbl-abbonamento',
  )
  assert.equal(
    canonicalLegacyPath('/it/prodotto/skin-face-3d%20-%20abbonamento'),
    '/it/prodotto/skin-face-3d-abbonamento',
  )
})

test('accetta il percorso gia decodificato e quello col + al posto dello spazio', () => {
  assert.equal(
    canonicalLegacyPath('/de/prodotto/t-sheet-dbl - abbonamento'),
    '/de/prodotto/t-sheet-dbl-abbonamento',
  )
  assert.equal(
    canonicalLegacyPath('/fr/prodotto/t-sheet-dbl+-+abbonamento'),
    '/fr/prodotto/t-sheet-dbl-abbonamento',
  )
})

test('senza prefisso di lingua il dirottamento resta senza lingua', () => {
  assert.equal(
    canonicalLegacyPath('/prodotto/t-sheet-dbl%20-%20abbonamento'),
    '/prodotto/t-sheet-dbl-abbonamento',
  )
})

test('lo slug corretto non viene toccato (niente anello di redirect)', () => {
  assert.equal(canonicalLegacyPath('/es/prodotto/t-sheet-dbl-abbonamento'), null)
  assert.equal(canonicalLegacyPath('/es/prodotto/t-sheet-dbl'), null)
  assert.equal(canonicalLegacyPath('/es/prodotto/t-sheet-dbl-in-rotolo'), null)
})

test('percorsi che non sono di prodotto, o con altra lingua, restano intatti', () => {
  assert.equal(canonicalLegacyPath('/es/tattoo'), null)
  assert.equal(canonicalLegacyPath('/xx/prodotto/t-sheet-dbl%20-%20abbonamento'), null)
  assert.equal(canonicalLegacyPath('/es/prodotto/non-esiste%20-%20x'), null)
  assert.equal(canonicalLegacyPath('/'), null)
})

test('percent-encoding malformato non fa esplodere la richiesta', () => {
  assert.equal(canonicalLegacyPath('/es/prodotto/%zz'), null)
})

// ------------------------------- URL assoluto del dirottamento (parte del middleware)

test('il Location e` assoluto e usa l host pubblico, non l indirizzo interno', () => {
  const target = legacyRedirectUrl(PROD_REQUEST.pathname, {
    requestUrl: PROD_REQUEST,
    host: 'thefoolishbutcher.com',
    forwardedProto: 'https',
  })
  assert.equal(target, 'https://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento')
  assert.ok(!String(target).includes('0.0.0.0'))
  assert.ok(!String(target).includes('8080'))
})

test('x-forwarded-proto a lista (o assente) non fa fallire il dirottamento', () => {
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      host: 'thefoolishbutcher.com',
      forwardedProto: 'https, http',
    }),
    'https://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento',
  )
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      host: 'thefoolishbutcher.com',
      forwardedProto: '',
    }),
    'http://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento',
  )
})

test('senza host utilizzabile non si emette alcun Location (resta il 404 di prima)', () => {
  assert.equal(legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, host: '' }), null)
  assert.equal(legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, host: '0.0.0.0:8080' }), null)
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: new URL('http://127.0.0.1:3000/x'), host: null }),
    null,
  )
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, host: 'proxy.railway.internal' }),
    null,
  )
})

test('un host che porta percorso o credenziali non diventa un Location', () => {
  assert.equal(legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, host: 'evil.example/path' }), null)
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, host: 'thefoolishbutcher.com@evil.example' }),
    null,
  )
})

test('la porta interna 8080 si scarta, le altre restano (sviluppo locale)', () => {
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      host: 'thefoolishbutcher.com:8080',
      forwardedProto: 'https',
    }),
    'https://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento',
  )
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      host: '127.0.0.1:3000',
      forwardedProto: 'http',
    }),
    null,
  )
})

test('un host a lista usa il primo elemento', () => {
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      host: 'thefoolishbutcher.com, proxy.internal',
      forwardedProto: 'https',
    }),
    'https://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento',
  )
})

test('uno slug non in mappa non produce alcun URL', () => {
  assert.equal(
    legacyRedirectUrl('/es/prodotto/duoskin', { requestUrl: PROD_REQUEST, host: 'thefoolishbutcher.com' }),
    null,
  )
})
