import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'section', 'active', 'updatedAt'],
    group: 'Catalogo',
  },
  access: {
    read: () => true,
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
      admin: { description: 'Es. foglio-pelle-tattoo — solo minuscole e trattini' },
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
      admin: { description: 'Numero piu basso = appare prima' },
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
      label: 'Nota artigianalita',
      admin: {
        description: 'Testo che sottolinea unicita artigianale. Es: "Non avrai mai due ordini con la stessa pelle."',
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

    // PREZZO BASE — formato entry (quello piu piccolo/economico)
    {
      name: 'basePrice',
      type: 'number',
      required: true,
      label: 'Prezzo base (EUR, IVA inclusa)',
      admin: { description: 'Prezzo del formato piu piccolo/entry. Le varianti hanno prezzi specifici.' },
    },

    // VARIANTI — formati con prezzo proprio
    {
      name: 'variants',
      type: 'array',
      label: 'Varianti (formati)',
      minRows: 1,
      admin: { description: 'Ogni riga = un formato disponibile (A5, A4, XXL). Ogni variante ha il suo prezzo.' },
      fields: [
        {
          name: 'sku',
          type: 'text',
          required: true,
          label: 'SKU',
          admin: { description: 'Es. FP-A5, FP-A4, FP-XXL' },
        },
        {
          name: 'label',
          type: 'text',
          required: true,
          label: 'Etichetta',
          admin: { description: 'Es. "A5", "A4", "XXL"' },
        },
        {
          name: 'price',
          type: 'number',
          required: true,
          label: 'Prezzo (EUR, IVA inclusa)',
          min: 0,
        },
        {
          name: 'stockStatus',
          type: 'select',
          defaultValue: 'available',
          label: 'Disponibilita',
          options: [
            { label: 'Disponibile', value: 'available' },
            { label: 'Ultimi pezzi', value: 'low' },
            { label: 'Non disponibile', value: 'unavailable' },
          ],
        },
        {
          name: 'limitedQty',
          type: 'number',
          label: 'Quantita limitata (opzionale)',
          admin: { description: 'Mostra "X pezzi rimasti" se compilato' },
        },
        {
          name: 'dimensions',
          type: 'text',
          label: 'Dimensioni',
          admin: { description: 'Es. "30x20 cm"' },
        },
        {
          name: 'thicknessMm',
          type: 'number',
          label: 'Spessore (mm)',
        },

        // COMBINAZIONI VALIDE — quali mix attributi sono acquistabili per questa variante
        // Se vuoto = tutti i valori sono disponibili
        // Se popolato = solo queste combinazioni sono acquistabili
        {
          name: 'validCombinations',
          type: 'array',
          label: 'Combinazioni valida (opzionale)',
          admin: { description: 'Se vuoto, tutte le combinazioni sono disponibili. Se popolato, solo queste combinazioni sono acquistabili.' },
          fields: [
            {
              name: 'texture',
              type: 'text',
              label: 'Texture',
            },
            {
              name: 'colore',
              type: 'text',
              label: 'Colore',
            },
            {
              name: 'spessore',
              type: 'text',
              label: 'Spessore',
            },
            {
              name: 'stencil',
              type: 'text',
              label: 'Stencil',
            },
        },
      ],
    },

    // ATTRIBUTI — personalizzazioni che NON modificano il prezzo
    {
      name: 'attributes',
      type: 'array',
      label: 'Attributi personalizzazione',
      admin: { description: 'Es: texture, colore, spessore. NON modificano il prezzo.' },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          label: 'Nome tecnico',
          admin: { description: 'Es: texture, colore, spessore — usa solo lettere minuscole e trattini' },
        },
        {
          name: 'label',
          type: 'text',
          required: true,
          label: 'Etichetta visibile',
          admin: { description: 'Es: "Texture", "Colore", "Spessore"' },
        },
        {
          name: 'options',
          type: 'array',
          required: true,
          label: 'Opzioni disponibili',
          minRows: 1,
          fields: [
            {
              name: 'value',
              type: 'text',
              required: true,
              label: 'Valore tecnico',
              admin: { description: 'Es: liscia, ruvida, naturale, 4mm' },
            },
            {
              name: 'label',
              type: 'text',
              required: true,
              label: 'Etichetta visibile',
              admin: { description: 'Es: "Liscia", "Ruvida", "Naturale", "4mm"' },
            },
          ],
        },
      ],
    },
  ],
  timestamps: true,
}
