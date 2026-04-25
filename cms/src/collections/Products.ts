import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'section', 'active', 'updatedAt'],
    group: 'Catalogo',
  },
  access: {
    read: () => true, // pubblico per storefront
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Nome prodotto',
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Slug (URL)',
      admin: { description: 'Es. t-sheet-dbl — solo minuscole e trattini' },
    },
    {
      name: 'section',
      type: 'select',
      required: true,
      label: 'Sezione',
      options: [
        { label: 'Tattoo', value: 'tattoo' },
        { label: 'PMU (Permanent Make-up)', value: 'pmu' },
      ],
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'Visibile nella vetrina',
    },
    {
      name: 'limitedStock',
      type: 'checkbox',
      defaultValue: false,
      label: 'Stock limitato (appare in sezione speciale)',
    },
    {
      name: 'order',
      type: 'number',
      defaultValue: 0,
      label: 'Ordine di visualizzazione',
      admin: { description: 'Numero più basso = appare prima' },
    },
    {
      name: 'shortDescription',
      type: 'text',
      label: 'Descrizione breve (griglia)',
      admin: { description: 'Max 120 caratteri — appare nella card prodotto' },
    },
    {
      name: 'description',
      type: 'richText',
      label: 'Descrizione completa',
    },
    {
      name: 'uniqueNote',
      type: 'textarea',
      label: 'Nota artigianalità',
      admin: {
        description: 'Testo che sottolinea l\'unicità artigianale. Es: "Non avrai mai due ordini con la stessa pelle."',
        condition: (_, siblingData) => siblingData?.slug?.includes('dbl'),
      },
    },
    {
      name: 'images',
      type: 'array',
      label: 'Immagini',
      minRows: 1,
      fields: [
        {
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          required: true,
        },
        {
          name: 'alt',
          type: 'text',
          label: 'Testo alternativo',
        },
      ],
    },
    {
      name: 'variants',
      type: 'array',
      label: 'Varianti',
      minRows: 1,
      fields: [
        {
          name: 'sku',
          type: 'text',
          required: true,
          label: 'SKU',
          admin: { description: 'Es. DBL-A4, DUOSKIN-A4-PELLE' },
        },
        {
          name: 'label',
          type: 'text',
          required: true,
          label: 'Etichetta',
          admin: { description: 'Es. "A4", "A5 — Pelle", "Rotolo"' },
        },
        {
          name: 'price',
          type: 'number',
          required: true,
          label: 'Prezzo (€ IVA inclusa)',
          min: 0,
        },
        {
          name: 'dimensions',
          type: 'text',
          label: 'Dimensioni',
          admin: { description: 'Es. "30×20 cm"' },
        },
        {
          name: 'thicknessMm',
          type: 'number',
          label: 'Spessore (mm)',
        },
        {
          name: 'stockStatus',
          type: 'select',
          defaultValue: 'available',
          label: 'Disponibilità',
          options: [
            { label: 'Disponibile', value: 'available' },
            { label: 'Ultimi pezzi', value: 'low' },
            { label: 'Non disponibile', value: 'unavailable' },
          ],
        },
        {
          name: 'limitedQty',
          type: 'number',
          label: 'Quantità limitata (opzionale)',
          admin: { description: 'Mostra "X pezzi rimasti" se compilato' },
        },
      ],
    },
  ],
  timestamps: true,
}
