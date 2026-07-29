import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth'
import { checkVatNumber } from '@/lib/vies'
import { ensureB2BAuthTable, findB2BUserByEmail, createB2BUser } from '@/lib/db-auth'
import { createResellerOrder } from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'
import { calculateLineTotal } from '@/lib/pricing'
import { calculateResellerShipping } from '@/lib/shipping'
import type { PriceTier } from '@/lib/cms'

function generateOrderNumber(): string {
  const date = new Date()
  const yy = date.getFullYear().toString().slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `B2B-${yy}${mm}-${rand}`
}

export async function POST(req: NextRequest) {
  // 2026-07-29 — checkout aperto agli ospiti.
  //
  // Prima qui c'era un 401 secco: per comprare bisognava già avere un
  // account. Ma la registrazione è sempre stata libera e istantanea,
  // quindi quel 401 non proteggeva niente — costringeva solo il primo
  // ordine di un rivenditore nuovo a passare da una pagina di login,
  // cioè fermava esattamente la persona che l'email a freddo manda qui.
  //
  // Adesso l'identità si raccoglie nel form (email + ragione sociale +
  // partita IVA) e si verifica sul serio contro il VIES, qui lato
  // server: un controllo fatto solo nel browser lo aggira chiunque.
  const session = await getServerSession()

  const { form, items } = await req.json()

  const email = (session?.email ?? form?.email ?? '').toLowerCase().trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'email_non_valida' }, { status: 400 })
  }
  if (!form?.businessName?.trim()) {
    return NextResponse.json({ error: 'ragione_sociale_mancante' }, { status: 400 })
  }

  // Partita IVA: `invalid` ferma l'ordine, `unverified` no.
  // VIES è un servizio pubblico che cade a rotazione per singolo Stato
  // membro. Rifiutare chi sta pagando perché un'API governativa è giù
  // costa una vendita vera; accettare una partita IVA non verificata
  // costa un controllo manuale. Si sceglie il costo minore, e si lascia
  // la traccia perché il controllo avvenga davvero.
  const vat = await checkVatNumber(form?.vatNumber ?? '')
  if (vat.status === 'invalid') {
    return NextResponse.json(
      { error: 'partita_iva_non_valida', detail: vat.detail },
      { status: 400 },
    )
  }

  // Recalculate total server-side — never trust client-supplied amounts
  const lineItemsForEmail = (items as {
    productName: string; variantLabel: string; qty: number; unitPrice: number; priceTiers: PriceTier[]
  }[]).map(item => ({
    name: `${item.productName} — ${item.variantLabel}`,
    qty: item.qty,
    total: calculateLineTotal(item.unitPrice, item.qty, item.priceTiers),
  }))
  const productsTotal = lineItemsForEmail.reduce((sum, i) => sum + i.total, 0)
  const shipping = calculateResellerShipping(productsTotal, form.shippingCountry)
  const serverTotal = productsTotal + shipping.cost

  const orderNumber = generateOrderNumber()

  // Traccia dell'esito VIES sull'ordine. Sta nelle note e non in una
  // colonna nuova di proposito: serve che chi prepara la spedizione la
  // veda, non che qualcuno la interroghi.
  const vatNote =
    vat.status === 'valid'
      ? `[VIES OK] ${vat.name ?? 'partita IVA valida'}${vat.address ? ' — ' + vat.address : ''}`
      : `[VIES NON VERIFICATA — controllare a mano] ${vat.detail ?? ''}`
  const notes = [form.notes?.trim(), vatNote].filter(Boolean).join('\n')

  // Ospite: l'account nasce dall'ordine, senza password. La imposta al
  // primo accesso (percorso già esistente per i migrati da pro_members)
  // e da lì vede lo storico.
  if (!session) {
    try {
      await ensureB2BAuthTable()
      const existing = await findB2BUserByEmail(email)
      if (!existing) {
        await createB2BUser(email, form.businessName, null)
      }
    } catch (err) {
      // Un ordine valido non si perde perché non siamo riusciti a
      // creare l'anagrafica: l'ordine viene comunque registrato.
      console.error('[checkout] creazione account ospite fallita:', err)
    }
  }

  try {
    await createResellerOrder({
      orderNumber,
      customerEmail: email,
      customerName: form.shippingName,
      vatNumber: form.vatNumber,
      businessName: form.businessName,
      sdiCode: form.sdiCode,
      billingAddress1: form.billingAddress1,
      billingCity: form.billingCity,
      billingPostalCode: form.billingPostalCode,
      billingCountry: form.billingCountry,
      shippingAddressName: form.shippingName,
      shippingAddress1: form.shippingAddress1,
      shippingCity: form.shippingCity,
      shippingPostalCode: form.shippingPostalCode,
      shippingCountry: form.shippingCountry,
      lineItems: items,
      total: serverTotal,
      shippingCost: shipping.cost,
      paymentMethod: 'bonifico',
      notes,
    })
  } catch (err) {
    console.error('[checkout] createResellerOrder failed:', err)
    return NextResponse.json({ error: 'Errore creazione ordine' }, { status: 500 })
  }

  try {
    await sendOrderConfirmation({
      email,
      contactName: session?.contactName ?? form.shippingName ?? '',
      orderNumber,
      total: serverTotal,
      paymentMethod: 'bonifico',
      lineItems: lineItemsForEmail,
    })
  } catch (err) {
    console.error('[checkout] sendOrderConfirmation failed:', err)
    // Order is already saved — don't fail the request
  }

  return NextResponse.json({ orderNumber })
}
