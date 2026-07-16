import type { PayloadRequest } from 'payload'
import type { Product } from '../payload-types'

interface PrintfulVariant {
  id: number
  name: string
  retail_price: string
}

interface PrintfulSyncProduct {
  id: number
  name: string
  thumbnail_url?: string
}

interface PrintfulListItem {
  sync_product: PrintfulSyncProduct
  sync_variants: PrintfulVariant[]
}

interface PrintfulListResponse {
  result: Array<{ id: number }>
}

interface PrintfulDetailResponse {
  result: {
    sync_product: PrintfulSyncProduct
    sync_variants: PrintfulVariant[]
  }
}

async function fetchPrintfulProducts(): Promise<PrintfulListItem[]> {
  const apiKey = process.env.PRINTFUL_API_KEY
  if (!apiKey) throw new Error('PRINTFUL_API_KEY non configurata')

  const listRes = await fetch('https://api.printful.com/store/products', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!listRes.ok) throw new Error(`Printful list failed: ${listRes.status}`)
  const listData = (await listRes.json()) as PrintfulListResponse

  const items: PrintfulListItem[] = []
  for (const item of listData.result) {
    const detailRes = await fetch(`https://api.printful.com/store/products/${item.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!detailRes.ok) throw new Error(`Printful detail failed for ${item.id}: ${detailRes.status}`)
    const detail = (await detailRes.json()) as PrintfulDetailResponse
    items.push({ sync_product: detail.result.sync_product, sync_variants: detail.result.sync_variants })
  }
  return items
}

// Tipo delle righe dell'array `variants` cosi come generato da Payload per la collection Products.
type ProductVariant = NonNullable<Product['variants']>[number]

interface SyncResult {
  id: Product['id']
  created: boolean
  name: string
  skipped?: string
}

export async function syncPrintfulHandler(req: PayloadRequest): Promise<Response> {
  if (!req.user) {
    return Response.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  try {
    const printfulProducts = await fetchPrintfulProducts()
    const results: SyncResult[] = []

    for (const { sync_product, sync_variants } of printfulProducts) {
      const printfulSyncProductId = String(sync_product.id)

      // Math.min(...[].map(...)) su un array vuoto restituisce Infinity (non NaN):
      // senza questa guardia scriveremmo basePrice: Infinity su un prodotto reale.
      if (sync_variants.length === 0) {
        results.push({ id: 0, created: false, name: sync_product.name, skipped: 'nessuna variante da Printful' })
        continue
      }

      const existing = await req.payload.find({
        collection: 'products',
        where: { printfulSyncProductId: { equals: printfulSyncProductId } },
        limit: 1,
        overrideAccess: true,
      })

      const variants: ProductVariant[] = sync_variants.map((v) => ({
        sku: `PF-${v.id}`,
        label: v.name,
        price: parseFloat(v.retail_price),
        printfulSyncVariantId: String(v.id),
      }))

      // basePrice e obbligatorio sullo schema: usiamo il prezzo variante piu basso come base.
      // Va ricalcolato ad ogni sync (anche in update) perche i prezzi Printful possono cambiare.
      const basePrice = Math.min(...variants.map((v) => v.price))

      if (existing.docs.length === 0) {
        const slug = `merch-${printfulSyncProductId}-${sync_product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`

        const created = await req.payload.create({
          collection: 'products',
          data: {
            name: sync_product.name,
            slug,
            section: 'merch',
            active: false, // resta nascosto finche non completi manualmente descrizione/traduzioni
            printfulSyncProductId,
            basePrice,
            variants,
            images: [], // le immagini Printful vanno caricate manualmente in Media — fuori scope l'auto-download
          },
          overrideAccess: true,
        })
        results.push({ id: created.id, created: true, name: sync_product.name })
      } else {
        const doc = existing.docs[0]
        await req.payload.update({
          collection: 'products',
          id: doc.id,
          data: { variants, basePrice },
          overrideAccess: true,
        })
        results.push({ id: doc.id, created: false, name: sync_product.name })
      }
    }

    return Response.json({ ok: true, synced: results.length, results })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Sync fallito' }, { status: 500 })
  }
}
