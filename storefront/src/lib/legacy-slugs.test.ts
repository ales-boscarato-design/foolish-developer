import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalLegacyPath } from './legacy-slugs'

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
