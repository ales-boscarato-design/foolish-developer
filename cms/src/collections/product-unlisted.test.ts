import assert from 'node:assert/strict'
import test from 'node:test'
import { Products } from './Products'

test('Products sidebar visibility fields preserve active semantics and enforce unlisted contracts', () => {
  const visibility = Products.fields.find((field) => 'type' in field && field.type === 'collapsible' && field.label === 'Visibilità')
  assert.ok(visibility && 'fields' in visibility && visibility.admin?.position === 'sidebar')
  const active = visibility.fields.find((field) => 'name' in field && field.name === 'active')
  assert.ok(active && 'type' in active && active.type === 'checkbox')
  assert.equal(active.defaultValue, true)
  assert.equal(active.label, 'Retail: griglie, sitemap e checkout retail')
  assert.equal(active.admin?.description, 'Se disattivato, il prodotto esce da home, categorie, sitemap e checkout retail. La scheda diretta per slug resta raggiungibile e alcuni riferimenti nei kit o nelle recensioni possono ancora mostrarlo. Non è un interruttore del B2B né degli abbonamenti.')
  const unlisted = visibility.fields.find((field) => 'name' in field && field.name === 'unlisted')
  const supersededBy = visibility.fields.find((field) => 'name' in field && field.name === 'supersededBy')
  assert.ok(unlisted && 'type' in unlisted && unlisted.type === 'checkbox')
  assert.equal(unlisted.defaultValue, false)
  assert.equal(unlisted.index, true)
  assert.equal(unlisted.label, 'Ritirato dal retail (301/404) — non spegne B2B né abbonamenti che lo referenziano')
  assert.equal(unlisted.admin?.description, 'Ritira il prodotto dal retail: fuori da griglie e sitemap, con redirect 301 alla scheda sostitutiva (supersededBy) oppure 404. Non tocca il B2B, che dipende da resellerVisible, e non spegne un abbonamento: per fermare un abbonamento si disattiva il piano, non il prodotto.')
  assert.ok(supersededBy && 'type' in supersededBy && supersededBy.type === 'text')
  assert.equal(supersededBy.maxLength, 63)
  assert.equal(typeof supersededBy.validate, 'function')
  const validate = supersededBy.validate as (value: unknown) => true | string
  for (const slug of ['a', 'a1', 'new-product', 'two--hyphens', 'a'.repeat(63), null, '']) {
    assert.equal(validate(slug), true, `accepted: ${String(slug)}`)
  }
  for (const slug of ['A', '-slug', 'slug-', 'with space', 'a'.repeat(64), '../outside']) {
    assert.notEqual(validate(slug), true, `rejected: ${slug}`)
  }
})
