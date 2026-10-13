import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalLegacyPath, legacyRedirectUrl } from './legacy-slugs'

// L'URL della richiesta come lo vede il container dietro il proxy di Railway:
// indirizzo interno e porta 8080, che non devono mai finire nel `Location`.
const PROD_REQUEST = new URL('http://0.0.0.0:8080/es/prodotto/t-sheet-dbl%20-%20abbonamento')
const PUBLIC = { hosts: ['thefoolishbutcher.com'], forwardedProto: 'https' }
const CANONICAL = 'https://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento'

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
  const target = legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, ...PUBLIC })
  assert.equal(target, CANONICAL)
  assert.ok(!String(target).includes('0.0.0.0'))
  assert.ok(!String(target).includes('8080'))
})

test('x-forwarded-proto a lista, maiuscolo o assente non fa fallire il dirottamento', () => {
  const withProto = (forwardedProto: string) =>
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts: ['thefoolishbutcher.com'], forwardedProto })
  assert.equal(withProto('https, http'), CANONICAL)
  assert.equal(withProto('https '), CANONICAL)
  assert.equal(withProto('HTTPS'), CANONICAL)
  assert.equal(withProto('https://'), 'http://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento')
  assert.equal(withProto(''), 'http://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento')
  assert.equal(withProto('ftp'), 'http://thefoolishbutcher.com/es/prodotto/t-sheet-dbl-abbonamento')
})

test('la query string del link storico resta nel dirottamento', () => {
  const request = new URL('http://0.0.0.0:8080/es/prodotto/t-sheet-dbl%20-%20abbonamento?utm_source=ig&utm_campaign=x')
  assert.equal(
    legacyRedirectUrl(request.pathname, { requestUrl: request, ...PUBLIC }),
    `${CANONICAL}?utm_source=ig&utm_campaign=x`,
  )
})

test('senza host utilizzabile non si emette alcun Location (resta il 404 di prima)', () => {
  const target = (hosts: (string | null)[]) =>
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts })
  assert.equal(target(['']), null)
  assert.equal(target(['0.0.0.0:8080']), null)
  assert.equal(target(['proxy.railway.internal']), null)
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: new URL('http://127.0.0.1:3000/x'), hosts: [null] }),
    null,
  )
})

test('gli indirizzi di rete privata non diventano un Location', () => {
  const target = (host: string) =>
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts: [host], forwardedProto: 'https' })
  for (const host of [
    '10.0.0.5:8080',
    '172.16.0.9',
    '172.31.255.1',
    '192.168.1.7:3131',
    '169.254.1.1',
    '0.1.2.3',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
  ]) {
    assert.equal(target(host), null, `${host} non deve finire in un Location`)
  }
  // Il resto della rete privata non e` privato: 172.15 e 172.32 sono pubblici.
  assert.equal(target('172.15.0.1'), 'https://172.15.0.1/es/prodotto/t-sheet-dbl-abbonamento')
  assert.equal(target('172.32.0.1'), 'https://172.32.0.1/es/prodotto/t-sheet-dbl-abbonamento')
})

test('le notazioni IPv4 alternative non aggirano il blocco (il parser le normalizza)', () => {
  const target = (host: string) =>
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts: [host], forwardedProto: 'https' })
  // Tutte queste il parser URL le riscrive su 0.0.0.0 / 127.0.0.1 / 10.0.0.1: il controllo
  // deve vedere l'host come lo vedra` il browser, non la stringa scritta a mano.
  for (const host of ['0', '127.1', '2130706433', '0x7f000001', '0177.0.0.1', '10.1', '169.254.169.254']) {
    assert.equal(target(host), null, `${host} non deve diventare un Location interno`)
  }
})

test('un IPv6 senza parentesi o un doppio punto e virgola non finiscono nel Location', () => {
  const target = (host: string) =>
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts: [host], forwardedProto: 'https' })
  for (const host of ['fdaa:0:1::1', '[::1]', '[2001:4860:4860::8888]', 'evil.example:80:90']) {
    assert.equal(target(host), null, `${host} non e' un host di questo sito`)
  }
})

test('un host che porta percorso o credenziali non diventa un Location', () => {
  const target = (host: string) => legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts: [host] })
  assert.equal(target('evil.example/path'), null)
  assert.equal(target('thefoolishbutcher.com@evil.example'), null)
  assert.equal(target('thefoolishbutcher..com'), null)
  assert.equal(target('thefoolishbutcher.com\\evil.example'), null)
  assert.equal(target('-foo.example'), null)
})

test('un host inutilizzabile non scarta quello valido successivo', () => {
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      hosts: ['0.0.0.0:8080', 'thefoolishbutcher.com'],
      forwardedProto: 'https',
    }),
    CANONICAL,
  )
})

test('la porta interna 8080 si scarta, le altre restano (sviluppo locale)', () => {
  const target = (host: string) =>
    legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, hosts: [host], forwardedProto: 'https' })
  assert.equal(target('thefoolishbutcher.com:8080'), CANONICAL)
  assert.equal(target('staging.thefoolishbutcher.com:8443'), 'https://staging.thefoolishbutcher.com:8443/es/prodotto/t-sheet-dbl-abbonamento')
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      hosts: ['127.0.0.1:3000'],
      forwardedProto: 'http',
    }),
    null,
  )
})

test('un host a lista usa il primo elemento utile, e accetta il punto finale', () => {
  const target = (host: string) => legacyRedirectUrl(PROD_REQUEST.pathname, { requestUrl: PROD_REQUEST, ...PUBLIC, hosts: [host] })
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      hosts: ['thefoolishbutcher.com, proxy.internal'],
      forwardedProto: 'https',
    }),
    CANONICAL,
  )
  assert.equal(
    legacyRedirectUrl(PROD_REQUEST.pathname, {
      requestUrl: PROD_REQUEST,
      hosts: [null, 'thefoolishbutcher.com'],
      forwardedProto: 'https',
    }),
    CANONICAL,
  )
  assert.equal(target('thefoolishbutcher.com.'), CANONICAL)
  assert.equal(target('THEFOOLISHBUTCHER.COM'), CANONICAL)
})

test('uno slug non in mappa non produce alcun URL', () => {
  assert.equal(legacyRedirectUrl('/es/prodotto/duoskin', { requestUrl: PROD_REQUEST, ...PUBLIC }), null)
})
