// Server-only builders shared by the canonical checkout and the account reorder.
// Keeping the Stripe line items and the shipping metadata in one place means the
// webhook sees the same contract from both flows: a change here cannot drift
// between "buy now" and "reorder".
import type { ExtraEuShippingResolution } from './landed-cost'
import type { ChargedProductLine } from './promo'

export interface StripeCheckoutLineItem {
  price_data: {
    currency: 'eur'
    unit_amount: number
    product_data: {
      name: string
      metadata?: { sku: string }
    }
  }
  quantity: number
}

/**
 * The exact line items the canonical checkout sends to Stripe: product rows
 * named `${name} — ${variantLabel}` with the SKU in `product_data.metadata`,
 * plus the single `Spedizione` row when shipping costs something.
 */
export function buildStripeLineItems(
  lines: ChargedProductLine[],
  shippingCostCents: number,
): StripeCheckoutLineItem[] {
  const productLines: StripeCheckoutLineItem[] = lines.map((item) => ({
    price_data: {
      currency: 'eur',
      unit_amount: item.unitAmountCents,
      product_data: {
        name: `${item.name} — ${item.variantLabel}`,
        metadata: { sku: item.sku },
      },
    },
    quantity: item.qty,
  }))

  const shippingLines: StripeCheckoutLineItem[] = shippingCostCents > 0
    ? [{
        price_data: {
          currency: 'eur',
          unit_amount: shippingCostCents,
          product_data: { name: 'Spedizione' },
        },
        quantity: 1,
      }]
    : []

  return [...productLines, ...shippingLines]
}

/** Metadata for an IT/EU flat carrier rate. */
export function buildCarrierShippingMetadata(): Record<string, string> {
  return { shipping_source: 'carrier_flat' }
}

/**
 * Metadata for a landed-cost (extra-EU) resolution. Same keys and same parcel
 * JSON shape as the canonical checkout, so the webhook and the shipping
 * pipeline read one contract.
 */
export function buildExtraEuShippingMetadata(
  resolution: ExtraEuShippingResolution,
): Record<string, string> {
  const metadata: Record<string, string> = {
    shipping_source: resolution.source,
    shipping_basis_cents: String(resolution.basisCostCents),
  }
  if (resolution.quote?.checkoutInvoiceNumber) {
    metadata.shipping_quote_ref = resolution.quote.checkoutInvoiceNumber
  }
  if (resolution.quote?.parcel) {
    const parcel = resolution.quote.parcel
    metadata.shipping_parcel_json = JSON.stringify({
      weight: parcel.weightKg,
      length: parcel.lengthCm,
      width: parcel.widthCm,
      height: parcel.heightCm,
      packages: parcel.packages,
    })
  }
  return metadata
}
