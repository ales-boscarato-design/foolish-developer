import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { render } from 'react-email'
import { WelcomeEmail } from './welcome'
import { getEmailCopy } from './copy'

test('email copy loads every supported locale and falls back to Italian', () => {
  for (const locale of ['it', 'en', 'de', 'fr', 'es']) {
    const copy = getEmailCopy(locale)
    assert.ok(copy.footer.site)
    assert.ok(copy.welcome.subject)
  }

  assert.deepEqual(getEmailCopy('unknown').footer, getEmailCopy('it').footer)
})

test('welcome email renders through the unified React Email package', async () => {
  const html = await render(React.createElement(WelcomeEmail, {
    name: 'Test Customer',
    locale: 'en',
    unsubscribeUrl: 'https://thefoolishbutcher.com/unsubscribe',
  }))

  assert.match(html, /The Foolish Butcher/)
  assert.match(html, /Test/)
})
