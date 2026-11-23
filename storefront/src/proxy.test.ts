import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import proxy from './proxy'

const LOCALES = ['it', 'en', 'fr', 'es', 'de'] as const
const PUBLIC_HOST = 'thefoolishbutcher.com'

function redirect(path: string, host = '0.0.0.0:8080', forwardedHost = PUBLIC_HOST) {
  const request = new NextRequest(`http://0.0.0.0:8080${path}`, {
    headers: {
      host,
      ...(forwardedHost ? { 'x-forwarded-host': forwardedHost } : {}),
      'x-forwarded-proto': 'https',
    },
  })
  return proxy(request)
}

test('the actual proxy redirects the duplicate product slug to the base product in every locale', () => {
  for (const locale of LOCALES) {
    const response = redirect(`/${locale}/prodotto/t-sheet-dbl-abbonamento`)
    assert.equal(response.status, 301, `${locale} status`)
    assert.equal(
      response.headers.get('location'),
      `https://${PUBLIC_HOST}/${locale}/prodotto/t-sheet-dbl`,
      `${locale} Location`,
    )
  }
})

test('the actual proxy redirects the encoded legacy spaced slug to the base product', () => {
  for (const locale of LOCALES) {
    const response = redirect(`/${locale}/prodotto/t-sheet-dbl%20-%20abbonamento`)
    assert.equal(response.status, 301, `${locale} status`)
    assert.equal(
      response.headers.get('location'),
      `https://${PUBLIC_HOST}/${locale}/prodotto/t-sheet-dbl`,
      `${locale} Location`,
    )
  }
})

test('www requests for both legacy URL forms redirect directly to the HTTPS apex in every locale', () => {
  for (const locale of LOCALES) {
    for (const legacySlug of ['t-sheet-dbl-abbonamento', 't-sheet-dbl%20-%20abbonamento']) {
      const response = redirect(`/${locale}/prodotto/${legacySlug}`, 'www.thefoolishbutcher.com', '')
      assert.equal(response.status, 301, `${locale}/${legacySlug} status`)
      assert.equal(
        response.headers.get('location'),
        `https://${PUBLIC_HOST}/${locale}/prodotto/t-sheet-dbl`,
        `${locale}/${legacySlug} Location`,
      )
    }
  }
})
