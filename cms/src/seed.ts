/**
 * Seed script — carica i 7 prodotti Foolish nel CMS.
 * Esegui: npx ts-node --esm src/seed.ts
 */
import payload from 'payload'

const products = [
  // ── TATTOO ────────────────────────────────────────────────
  {
    name: 'T-Sheet Skin DBL',
    slug: 't-sheet-dbl',
    section: 'tattoo',
    active: true,
    order: 1,
    shortDescription: 'Due facciate differenti: pelle e bianco. Ogni foglio è unico.',
    uniqueNote:
      'La produzione artigianale giornaliera crea ogni giorno prodotti diversi per colore, sfumatura e nuance. Non avrai mai due ordini con la stessa pelle. Esattamente come la pelle dei tuoi clienti.',
    variants: [
      { sku: 'DBL-A5',    label: 'A5',    price: 15,    dimensions: '20×15 cm', thicknessMm: 4, stockStatus: 'available' },
      { sku: 'DBL-A4',    label: 'A4',    price: 28,    dimensions: '30×20 cm', thicknessMm: 4, stockStatus: 'available' },
      { sku: 'DBL-L',     label: 'L',     price: 50,    dimensions: '60×40 cm', thicknessMm: 4, stockStatus: 'available' },
      { sku: 'DBL-XXL',   label: 'XXL',   price: 69.95, dimensions: '80×60 cm', thicknessMm: 4, stockStatus: 'available' },
      { sku: 'DBL-ROLL',  label: 'Rotolo', price: 150,  dimensions: '180×60 cm', thicknessMm: 4, stockStatus: 'available' },
    ],
    images: [],
  },
  {
    name: 'T-Sheet Skin DUOSKIN',
    slug: 't-sheet-duoskin',
    section: 'tattoo',
    active: true,
    order: 2,
    shortDescription: 'Due facciate identiche per consistenza e texture. Disponibile in Pelle e Bianco.',
    variants: [
      { sku: 'DUO-A5-PELLE',  label: 'A5 — Pelle',  price: 24, dimensions: '20×15 cm', thicknessMm: 8, stockStatus: 'available' },
      { sku: 'DUO-A5-BIANCO', label: 'A5 — Bianco', price: 24, dimensions: '20×15 cm', thicknessMm: 8, stockStatus: 'available' },
      { sku: 'DUO-A4-PELLE',  label: 'A4 — Pelle',  price: 38, dimensions: '30×20 cm', thicknessMm: 8, stockStatus: 'available' },
      { sku: 'DUO-A4-BIANCO', label: 'A4 — Bianco', price: 38, dimensions: '30×20 cm', thicknessMm: 8, stockStatus: 'available' },
      { sku: 'DUO-A3-PELLE',  label: 'A3 — Pelle',  price: 50, dimensions: '40×30 cm', thicknessMm: 6, stockStatus: 'available' },
      { sku: 'DUO-A3-BIANCO', label: 'A3 — Bianco', price: 50, dimensions: '40×30 cm', thicknessMm: 6, stockStatus: 'available' },
    ],
    images: [],
  },
  {
    name: 'Mano Iperrealistica per Tattoo',
    slug: 'mano-iperrealistica-tattoo',
    section: 'tattoo',
    active: true,
    order: 3,
    shortDescription: 'Riproduzione iperrealistica di una mano per practice avanzata.',
    variants: [
      { sku: 'MANO-TATTOO', label: 'Standard', price: 45, stockStatus: 'available' },
    ],
    images: [],
  },
  // ── PMU ──────────────────────────────────────────────────
  {
    name: 'Kit Viso Iperrealistico per PMU',
    slug: 'kit-viso-pmu',
    section: 'pmu',
    active: true,
    order: 1,
    shortDescription: 'Kit completo per la pratica del trucco permanente. Pelle ultra-realistica.',
    variants: [
      { sku: 'KIT-VISO-PMU', label: 'Kit completo', price: 75, stockStatus: 'available' },
    ],
    images: [],
  },
  {
    name: 'Sostegno da Tavolo per Kit Viso',
    slug: 'sostegno-tavolo-kit-viso',
    section: 'pmu',
    active: true,
    order: 2,
    shortDescription: 'Supporto da tavolo per il kit viso tridimensionale.',
    variants: [
      { sku: 'STAND-VISO', label: 'Standard', price: 15, stockStatus: 'available' },
    ],
    images: [],
  },
  {
    name: 'Supporto Viso 3D in Resina',
    slug: 'supporto-viso-3d-resina',
    section: 'pmu',
    active: true,
    order: 3,
    shortDescription: 'Supporto viso tridimensionale in resina, verniciato a mano.',
    variants: [
      { sku: 'SUPPORT-RESINA', label: 'Standard', price: 45, stockStatus: 'available' },
    ],
    images: [],
  },
  {
    name: 'Viso Iperrealistico per PMU',
    slug: 'viso-iperrealistico-pmu',
    section: 'pmu',
    active: true,
    order: 4,
    shortDescription: 'Viso iperrealistico per la pratica del trucco permanente.',
    variants: [
      { sku: 'VISO-PMU', label: 'Standard', price: 25, stockStatus: 'available' },
    ],
    images: [],
  },
]

async function seed() {
  await payload.init({
    secret: process.env.PAYLOAD_SECRET!,
    local: true,
  })

  console.log('⏳ Seeding products...')
  for (const product of products) {
    const existing = await payload.find({
      collection: 'products',
      where: { slug: { equals: product.slug } },
    })
    if (existing.docs.length > 0) {
      console.log(`  ⚠️  Skip (già esiste): ${product.slug}`)
      continue
    }
    await payload.create({ collection: 'products', data: product as any })
    console.log(`  ✅ Created: ${product.name}`)
  }
  console.log('✅ Seed completato.')
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
