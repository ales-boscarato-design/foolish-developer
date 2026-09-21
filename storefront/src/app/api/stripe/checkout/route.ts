import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { resolveCheckoutCatalog } from '@/lib/catalog'
import { shouldMarkAffiliateCheckoutPromo } from '@/lib/affiliate-checkout-marker'
import {
  AFFILIATE_REFERRAL_COOKIE,
  normalizeAffiliateSlug,
  resolveAffiliateBySlug,
} from '@/lib/affiliate-referral'
import {
  allocateProductDiscount,
  buildCheckoutMetadata,
  calculateCheckoutPromo,
  calculateServerShippingCostCents,
  cartSubtotalCents,
  normalizePromoCode,
  normalizeCheckoutCustomer,
  normalizeCheckoutItems,
  parsePromoCodes,
  type PromoRecord,
} from '@/lib/promo'
import { getShippingZone, isFreeShippingPromoAllowed, shippingRequiresQuote } from '@/lib/shipping'
import { resolveExtraEuShipping } from '@/lib/landed-cost'

type StripeAllowedCountry = NonNullable<
  Stripe.Checkout.SessionCreateParams['shipping_address_collection']
>['allowed_countries'][number]

export const dynamic = 'force-dynamic'

const STOREFRONT_URL = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'
const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'

async function assertCMSOrderAccess(): Promise<void> {
  const secret = process.env.PAYLOAD_API_SECRET
  if (!secret) throw new Error('PAYLOAD_API_SECRET non configurato')

  const response = await fetch(`${CMS_URL}/api/orders?limit=1&depth=0`, {
    headers: { 'x-storefront-secret': secret },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`CMS orders access failed ${response.status}`)
  }
}

async function findPromoRecord(code: string): Promise<PromoRecord | null> {
  const secret = process.env.PAYLOAD_API_SECRET

  if (secret) {
    try {
      const cmsRes = await fetch(
        `${CMS_URL}/api/promo-codes?where[code][equals]=${encodeURIComponent(code)}&depth=0&limit=1`,
        {
          headers: { 'x-storefront-secret': secret },
          cache: 'no-store',
        },
      )
      if (cmsRes.ok) {
        const cmsData = await cmsRes.json()
        const cmsCode = cmsData.docs?.[0] as PromoRecord | undefined
        // A CMS record wins over fallbacks, including inactive, mismatched, or
        // malformed records. calculateCheckoutPromo validates its code.
        if (cmsCode) return cmsCode
      }
    } catch {
      // CMS unreachable — the safe environment fallback may still be checked.
    }
  }

  // PROMO_CODES only carries a type, so accept the two types whose discount is
  // fully defined server-side. Personal percent offers are intentionally not
  // redeemed here because paid-order consumption is not atomic in this path.
  const type = parsePromoCodes(process.env.PROMO_CODES)[code]
  const safeType = type === 'free_shipping' || type === 'percent_pro' ? type : null
  return safeType ? { code, type: safeType, active: true } : null
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  // Non aprire una sessione di pagamento se il CMS non puo' registrare
  // l'ordine. Il webhook resta la fonte di verita', ma questo controllo evita
  // di incassare quando autenticazione o disponibilita' del CMS sono rotte.
  try {
    await assertCMSOrderAccess()
  } catch (err) {
    console.error('[stripe/checkout] CMS preflight failed:', err)
    return NextResponse.json(
      { error: 'Sistema ordini temporaneamente non disponibile' },
      { status: 503 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }

  const request = body as {
    items?: unknown
    customer?: unknown
    promoCode?: unknown
    quoteToken?: unknown
  }
  const items = request.items
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }
  const catalogResult = await resolveCheckoutCatalog(items)
  if (catalogResult.status === 'unavailable') {
    return NextResponse.json(
      { error: 'Catalogo temporaneamente non disponibile' },
      { status: 503 },
    )
  }
  if (catalogResult.status !== 'ok') {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }
  const normalizedItems = normalizeCheckoutItems(catalogResult.items)
  if (!normalizedItems) {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }

  const customer = normalizeCheckoutCustomer(request.customer)
  if (!customer) {
    return NextResponse.json({ error: 'Dati cliente non validi' }, { status: 400 })
  }

  // Destinazione extra-UE SENZA profilo (nessuna linea DDP: oggi il Brasile):
  // non esiste un prezzo da incassare. Si ferma l'ordine e si quota (con
  // sdoganamento, IVA all'importazione e fee DDP inclusi) invece di spedire
  // sotto costo. Dal 21/09/2026 i paesi senza misura ma con una linea DDP
  // VENDONO (aliquote del paese di destinazione + pavimento 48,00 EUR): questa
  // guardia non li intercetta piu', e resta come rete per i paesi senza profilo.
  if (shippingRequiresQuote(customer.country)) {
    return NextResponse.json(
      {
        error: 'Per questa destinazione calcoliamo la spedizione con lo sdoganamento incluso: scrivici e la quotiamo prima del pagamento.',
      },
      { status: 409 },
    )
  }

  const normalizedPromoCode = normalizePromoCode(request.promoCode)
  const promoWasSubmitted = request.promoCode !== undefined && request.promoCode !== null && request.promoCode !== ''
  if (promoWasSubmitted && !normalizedPromoCode) {
    return NextResponse.json({ error: 'Codice promo non valido' }, { status: 400 })
  }

  // Referral fallback: an affiliate link stores only the affiliate slug in a
  // first-party cookie. The slug is resolved server-side, so the visitor never
  // supplies the code and a forged cookie cannot invent an affiliate.
  const referralSlug = normalizeAffiliateSlug(req.cookies.get(AFFILIATE_REFERRAL_COOKIE)?.value)
  let promoCodeToApply = normalizedPromoCode
  let promoFromReferral = false
  if (!promoCodeToApply && referralSlug) {
    const referral = await resolveAffiliateBySlug(referralSlug)
    if (referral) {
      promoCodeToApply = referral.promoCode
      promoFromReferral = true
    }
  }

  let promoRecord: PromoRecord | null = null
  let promoResult: ReturnType<typeof calculateCheckoutPromo> = { status: 'none' }
  if (promoCodeToApply) {
    promoRecord = await findPromoRecord(promoCodeToApply)
    promoResult = calculateCheckoutPromo({
      promoCode: promoCodeToApply,
      items: normalizedItems,
      record: promoRecord,
    })
    if (promoResult.status !== 'valid') {
      // A submitted code must be valid. A referral code the visitor never asked
      // for must never block the sale: the discount is simply dropped, and no
      // affiliate marker is written.
      if (!promoFromReferral) {
        return NextResponse.json({ error: 'Codice promo non valido' }, { status: 400 })
      }
      promoRecord = null
      promoResult = { status: 'none' }
    }
  }

  const promo = promoResult.status === 'valid' ? promoResult.promo : null

  // shippingCost from the browser is intentionally ignored. IT/EU restano la
  // tariffa del corriere; extra-UE il prezzo nasce dalla quota live servita
  // dalla Pi (con la tabella in casa e il profilo di paese come rete): quello
  // che il cliente ha visto nel carrello e' quello che paga qui.
  const subtotalCents = cartSubtotalCents(normalizedItems)
  if (subtotalCents === null || subtotalCents <= 0) {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }

  let serverShippingCostCents: number | null = null
  const shippingMetadata: Record<string, string> = {}
  if (getShippingZone(customer.country) === 'EXTRA_EU') {
    const resolution = await resolveExtraEuShipping({
      countryCode: customer.country,
      goodsCents: subtotalCents,
      destination: { zip: customer.postalCode, city: customer.city },
      items: normalizedItems.map((item) => ({ sku: item.sku, quantity: item.quantity })),
      quoteToken: request.quoteToken,
    })
    if (!resolution) {
      // Nessuna base di prezzo per quella destinazione: non si vende a un
      // prezzo inventato (unica eccezione alla regola "un guasto costa
      // precisione, non vendite").
      return NextResponse.json(
        {
          error: 'Per questa destinazione non riusciamo a calcolare la spedizione con lo sdoganamento: scrivici e la quotiamo prima del pagamento.',
        },
        { status: 409 },
      )
    }
    serverShippingCostCents = resolution.costCents
    shippingMetadata.shipping_source = resolution.source
    shippingMetadata.shipping_basis_cents = String(resolution.basisCostCents)
    if (resolution.quote?.checkoutInvoiceNumber) {
      shippingMetadata.shipping_quote_ref = resolution.quote.checkoutInvoiceNumber
    }
    if (resolution.quote?.parcel) {
      const parcel = resolution.quote.parcel
      shippingMetadata.shipping_parcel_json = JSON.stringify({
        weight: parcel.weightKg,
        length: parcel.lengthCm,
        width: parcel.widthCm,
        height: parcel.heightCm,
        packages: parcel.packages,
      })
    }
  } else {
    serverShippingCostCents = calculateServerShippingCostCents(
      normalizedItems,
      customer.country,
      promo?.freeShipping === true,
    )
    shippingMetadata.shipping_source = 'carrier_flat'
  }
  if (serverShippingCostCents === null || !Number.isSafeInteger(serverShippingCostCents) || serverShippingCostCents < 0) {
    return NextResponse.json({ error: 'Costo di spedizione non valido' }, { status: 400 })
  }

  const discountAmountCents = promo?.discountAmountCents ?? 0
  const chargedProductLines = allocateProductDiscount(normalizedItems, discountAmountCents)
  if (!chargedProductLines) {
    return NextResponse.json({ error: 'Sconto non valido' }, { status: 400 })
  }

  const orderRef = `FOOLISH-${Date.now()}`
  const shippingCostCents = serverShippingCostCents

  const lineItems = [
    ...chargedProductLines.map((item) => ({
      price_data: {
        currency: 'eur',
        unit_amount: item.unitAmountCents,
        product_data: {
          name: `${item.name} — ${item.variantLabel}`,
          metadata: { sku: item.sku },
        },
      },
      quantity: item.qty,
    })),
    ...(shippingCostCents > 0 ? [{
      price_data: {
        currency: 'eur',
        unit_amount: shippingCostCents,
        product_data: { name: 'Spedizione' },
      },
      quantity: 1,
    }] : []),
  ]

  const metadata = buildCheckoutMetadata({
    orderRef,
    customer,
    chargedProductLines,
    shippingCostCents,
    // La promo "spedizione gratuita" non azzera una tariffa extra-UE: il
    // metadato registra cio' che e' successo davvero, non cio' che la promo
    // prometteva. Un documento che dichiara "spedizione gratuita" mentre la
    // spedizione e' stata incassata e' una discrepanza in fattura.
    promo: promo && promo.freeShipping && !isFreeShippingPromoAllowed(customer.country)
      ? { ...promo, freeShipping: false }
      : promo,
  })
  if (!metadata) {
    return NextResponse.json({ error: 'Dati ordine troppo lunghi' }, { status: 400 })
  }

  const shouldMarkAffiliate = await shouldMarkAffiliateCheckoutPromo(promoRecord)
  // Le chiavi della spedizione viaggiano con quelle dell'ordine: l'ordine
  // registra DA DOVE viene il prezzo della riga "spedizione e import" (quota
  // live, tabella in casa o profilo prudenziale), il riferimento della fattura
  // doganale di checkout e il collo quotato, cosi' la spedizione vera usa lo
  // stesso collo che ha prodotto il prezzo.
  const orderMetadata = { ...metadata, ...shippingMetadata }
  const sessionMetadata = shouldMarkAffiliate && promo
    ? {
        ...orderMetadata,
        affiliate_id: String(shouldMarkAffiliate.affiliateId),
        affiliate_slug: shouldMarkAffiliate.affiliateSlug,
        affiliate_promo_code: shouldMarkAffiliate.affiliatePromoCode,
      }
    : orderMetadata

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      customer_email: customer.email,
      billing_address_collection: 'auto',
      shipping_address_collection: {
        allowed_countries: [customer.country as StripeAllowedCountry],
      },
      success_url: `${STOREFRONT_URL}/grazie?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${STOREFRONT_URL}/checkout`,
      metadata: sessionMetadata,
      ...(shouldMarkAffiliate && promo
        ? {
            payment_intent_data: {
              metadata: {
                affiliate_id: String(shouldMarkAffiliate.affiliateId),
                affiliate_slug: shouldMarkAffiliate.affiliateSlug,
                affiliate_promo_code: shouldMarkAffiliate.affiliatePromoCode,
              },
            },
          }
        : {}),
    })

    return NextResponse.json({ checkoutUrl: session.url })
  } catch (err) {
    console.error('[stripe/checkout] Stripe session creation failed:', err)
    return NextResponse.json({ error: 'Pagamento temporaneamente non disponibile' }, { status: 502 })
  }
}
