/**
 * Il numero d'ordine e il deep link Telegram.
 *
 * PERCHE' QUESTI TEST ESISTONO. Il numero d'ordine era `FOOLISH-${Date.now()}`:
 * due clienti che pagavano nello stesso millisecondo ricevevano lo stesso
 * numero, il secondo pagamento trovava l'ordine del primo e restava addebitato
 * senza ordine. Questi test bloccano il ritorno a una generazione legata al
 * tempo, alla collisione e a un deep link che Telegram scarta in silenzio.
 *
 * Il test di forma sul SORGENTE (ultimo blocco) e' quello che rende i primi non
 * vacui: con `Date.now()` il flusso torna a collidere anche se `generateOrderRef`
 * resta perfetta, perche' nessuno la chiama.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ORDER_REF_LENGTH,
  TELEGRAM_BOT_URL,
  TELEGRAM_START_MAX_LENGTH,
  generateOrderRef,
  isGeneratedOrderRef,
  telegramOrderLink,
} from './order-ref'

const GENERATED_RE = /^FOOLISH-[0-9a-f]{32}$/

test('due numeri generati nello stesso millisecondo sono diversi', () => {
  const originalNow = Date.now
  Date.now = () => 1_700_000_000_000
  try {
    const first = generateOrderRef()
    const second = generateOrderRef()
    assert.notEqual(first, second)
    assert.match(first, GENERATED_RE)
    assert.match(second, GENERATED_RE)
  } finally {
    Date.now = originalNow
  }
})

test('1000 numeri generati non collidono e rispettano forma e limite Telegram', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 1_000; i += 1) {
    const orderRef = generateOrderRef()
    assert.match(orderRef, GENERATED_RE)
    assert.equal(orderRef.length, ORDER_REF_LENGTH)
    assert.equal(ORDER_REF_LENGTH, 40)
    // Il bot riceve `order_` + numero nel parametro `start`: 46 <= 64.
    assert.ok(
      `order_${orderRef}`.length <= TELEGRAM_START_MAX_LENGTH,
      `payload Telegram troppo lungo per ${orderRef}`,
    )
    seen.add(orderRef)
  }
  assert.equal(seen.size, 1_000, 'collisione tra numeri generati')
})

test('il numero non contiene componenti temporali ne spazi', () => {
  const orderRef = generateOrderRef()
  // 32 caratteri esadecimali: nessuna cifra decimale di timestamp possibile.
  assert.equal(orderRef.slice('FOOLISH-'.length).includes('1700000000'), false)
  assert.equal(/\s/.test(orderRef), false)
  assert.equal(isGeneratedOrderRef(orderRef), true)
})

test('isGeneratedOrderRef rifiuta i numeri del flusso vecchio e i valori sporchi', () => {
  for (const bad of [
    'FOOLISH-cs_live_abc123',
    'FOOLISH-1700000000000',
    'FOOLISH-ABCDEF0123456789ABCDEF0123456789',
    'FOOLISH-0123456789abcdef0123456789abcde',
    '',
    null,
    undefined,
    42,
  ]) {
    assert.equal(isGeneratedOrderRef(bad), false, `accettato per sbaglio: ${String(bad)}`)
  }
})

test('il deep link Telegram porta il numero nel parametro start', () => {
  const orderRef = generateOrderRef()
  const link = telegramOrderLink(orderRef)
  assert.equal(link, `${TELEGRAM_BOT_URL}?start=order_${orderRef}`)
  const start = new URL(link).searchParams.get('start')
  assert.equal(start, `order_${orderRef}`)
  assert.ok((start as string).length <= TELEGRAM_START_MAX_LENGTH)
})

test('un numero del flusso vecchio (oltre 64 caratteri) non produce un deep link rotto', () => {
  // `FOOLISH-cs_live_...` e' il numero che il codice inventava quando il metadata
  // `order_ref` mancava: 74+ caratteri con `order_`, quindi Telegram lo scarta.
  const legacy = 'FOOLISH-cs_live_51QhEXAMPLEexampleEXAMPLEexampleEXAMPLEexample'
  assert.ok(`order_${legacy}`.length > TELEGRAM_START_MAX_LENGTH)
  assert.equal(telegramOrderLink(legacy), TELEGRAM_BOT_URL)
  assert.equal(telegramOrderLink(null), TELEGRAM_BOT_URL)
  assert.equal(telegramOrderLink(''), TELEGRAM_BOT_URL)
})

/**
 * Guardia sul sorgente: i due punti che emettono un numero d'ordine devono usare
 * il generatore, non comporre `FOOLISH-` a mano. Senza questa, il test sui 1000
 * numeri resta verde anche se il checkout torna a `FOOLISH-${Date.now()}`.
 */
test('checkout e riordino generano il numero con generateOrderRef, mai dal tempo', () => {
  const files = [
    fileURLToPath(new URL('../app/api/stripe/checkout/route.ts', import.meta.url)),
    fileURLToPath(new URL('./reorder.ts', import.meta.url)),
  ]

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    assert.ok(
      source.includes('generateOrderRef()'),
      `${file}: non usa generateOrderRef()`,
    )
    assert.equal(
      source.includes('FOOLISH-${'),
      false,
      `${file}: compone ancora il numero d'ordine a mano (template letterale)`,
    )
    assert.equal(
      /orderRef\s*=\s*[^\n]*Date\.now\(\)/.test(source),
      false,
      `${file}: il numero d'ordine deriva ancora dal tempo`,
    )
  }
})
