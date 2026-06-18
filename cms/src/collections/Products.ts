import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'section', 'active', 'basePrice', 'updatedAt'],
    listSearchableFields: ['name', 'slug'],
    group: 'Catalogo',
    livePreview: {
      url: ({ data }) => {
        const slug = (data as Record<string, unknown>).slug as string | undefined
        return slug ? `https://thefoolishbutcher.com/it/prodotto/${slug}` : 'https://thefoolishbutcher.com/it'
      },
    },
  },
  access: {
    read: () => true,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
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
      admin: { description: 'Se disattivato, il prodotto non appare nelle griglie ma rimane accessibile via URL diretto e nei kit.' },
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
      name: 'madeToOrder',
      type: 'checkbox',
      defaultValue: false,
      label: 'Su ordinazione (premium)',
      admin: { description: 'Attiva per prodotti che vengono lavorati dopo l\'acquisto. Mostra tempi di produzione + spedizione.' },
    },
    {
      name: 'productionDays',
      type: 'number',
      label: 'Giorni di produzione',
      admin: {
        description: 'Giorni lavorativi per produrre il pezzo (solo su ordinazione)',
        condition: (data) => !!data.madeToOrder,
      },
    },
    {
      name: 'shippingDays',
      type: 'number',
      defaultValue: 3,
      label: 'Giorni di spedizione',
      admin: { description: 'Giorni lavorativi dalla spedizione alla consegna' },
    },
    {
      name: 'shortDescription',
      type: 'text',
      localized: true,
      label: 'Descrizione breve (griglia)',
      admin: { description: 'Max 120 caratteri — appare nella card prodotto' },
    },
    {
      name: 'description',
      type: 'richText',
      localized: true,
      label: 'Descrizione completa',
    },
    {
      name: 'uniqueNote',
      type: 'textarea',
      localized: true,
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

    {
      name: 'videos',
      type: 'array',
      label: 'Video prodotto',
      maxRows: 3,
      admin: { description: 'Video demo del prodotto (MP4 o WebM, max 50MB). Appaiono prima delle immagini nella gallery.' },
      fields: [
        {
          name: 'video',
          type: 'upload',
          relationTo: 'media',
          required: true,
          filterOptions: { mimeType: { in: ['video/mp4', 'video/webm'] } },
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

    // RIVENDITORI
    {
      name: 'resellerVisible',
      type: 'checkbox',
      label: 'Visibile ai rivenditori',
      defaultValue: false,
      admin: {
        description: 'Mostra questo prodotto nel portale rivenditori',
        position: 'sidebar',
      },
    },
    {
      name: 'resellerDescription',
      type: 'textarea',
      label: 'Descrizione per rivenditori',
      admin: {
        description: 'Testo mostrato solo nel portale rivenditori — non appare sul sito pubblico. Spiega il prodotto dal punto di vista del rivenditore.',
        condition: (data) => data.resellerVisible,
      },
    },
    {
      name: 'priceTiers',
      type: 'array',
      label: 'Fasce prezzo rivenditori',
      admin: {
        description: 'Sconto % per fascia di quantità. Lascia vuoto per non applicare sconti rivenditori.',
        condition: (data) => data.resellerVisible,
      },
      fields: [
        {
          name: 'minQty',
          type: 'number',
          label: 'Qtà minima',
          required: true,
          min: 1,
        },
        {
          name: 'maxQty',
          type: 'number',
          label: 'Qtà massima (lascia vuoto = illimitato)',
          min: 1,
        },
        {
          name: 'discountPercent',
          type: 'number',
          label: 'Sconto %',
          required: true,
          min: 0,
          max: 100,
        },
      ],
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
          name: 'image',
          type: 'upload',
          relationTo: 'media',
          label: 'Immagine variante (opzionale)',
          admin: { description: 'Se presente, viene mostrata al posto delle immagini prodotto quando il cliente seleziona questa variante.' },
        },
        {
          name: 'description',
          type: 'text',
          localized: true,
          label: 'Descrizione variante (opzionale)',
          admin: { description: 'Appare sotto i bottoni variante quando il cliente seleziona questa. Es: "Stai per acquistare un foglio 30×20×4mm — il formato ideale per braccia e gambe."' },
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
          ],
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
          localized: true,
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
              localized: true,
              label: 'Etichetta visibile',
              admin: { description: 'Es: "Liscia", "Ruvida", "Naturale", "4mm"' },
            },
          ],
        },
      ],
    },

    // FEATURE HIGHLIGHTS — 4 card sulla pagina prodotto
    {
      name: 'featureHighlights',
      type: 'array',
      label: 'Feature highlights (pagina prodotto)',
      admin: { description: '4 card che spiegano perche scegliere questo prodotto. Se vuoto, vengono usati i default.' },
      maxRows: 4,
      fields: [
        {
          name: 'icon',
          type: 'select',
          required: true,
          label: 'Icona',
          options: [
            { label: 'Sparkles (fatto a mano)', value: 'sparkles' },
            { label: 'Shield (sicurezza)', value: 'shield' },
            { label: 'Star (qualita)', value: 'star' },
            { label: 'Truck (spedizione)', value: 'truck' },
          ],
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          localized: true,
          label: 'Titolo',
        },
        {
          name: 'description',
          type: 'text',
          required: true,
          localized: true,
          label: 'Descrizione',
        },
      ],
    },

    // USAGE STEPS — 3 step "come si usa"
    {
      name: 'usageSteps',
      type: 'array',
      label: 'Come si usa (3 step)',
      admin: { description: '3 step guidati per l utilizzo del prodotto. Se vuoto, viene usato il default.' },
      maxRows: 3,
      fields: [
        {
          name: 'step',
          type: 'text',
          required: true,
          label: 'Numero step',
          admin: { description: 'Es: 01, 02, 03' },
        },
        {
          name: 'title',
          type: 'text',
          required: true,
          localized: true,
          label: 'Titolo',
        },
        {
          name: 'description',
          type: 'text',
          required: true,
          localized: true,
          label: 'Descrizione',
        },
      ],
    },

    // COMPONENTI — prodotti che compongono questo kit, acquistabili separatamente
    {
      name: 'components',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Componenti acquistabili separatamente',
      admin: {
        description: 'Prodotti che compongono questo kit. Appariranno nella pagina prodotto con il loro prezzo e un tasto "Aggiungi al carrello".',
      },
    },

    // PACK — quantità predefinite con sconto
    {
      name: 'packs',
      type: 'array',
      label: 'Pack (acquista di più, risparmia)',
      admin: {
        description: 'Offerte bundle con sconto. Es: "3 fogli -10%". Appaiono come cards di upsell sulla pagina prodotto.',
      },
      fields: [
        {
          name: 'name',
          type: 'text',
          required: true,
          localized: true,
          label: 'Nome pack',
          admin: { description: 'Es: "Starter Kit", "Pro Bundle"' },
        },
        {
          name: 'quantity',
          type: 'number',
          required: true,
          label: 'Quantità pezzi',
          min: 2,
          admin: { description: 'Quanti pezzi include il pack' },
        },
        {
          name: 'discountPercent',
          type: 'number',
          required: true,
          label: 'Sconto (%)',
          min: 1,
          max: 50,
          admin: { description: 'Es: 10 = 10% di sconto sul prezzo unitario × quantità' },
        },
        {
          name: 'badgeText',
          type: 'text',
          localized: true,
          label: 'Badge (opzionale)',
          admin: { description: 'Es: "Più venduto", "Miglior valore" — appare come tag colorato sulla card' },
        },
      ],
    },

    // WHATS IN THE BOX
    {
      name: 'whatsInTheBox',
      type: 'array',
      label: 'Contenuto confezione',
      admin: { description: 'Lista di cosa contiene la confezione. Se vuoto, viene usato il default.' },
      fields: [
        {
          name: 'label',
          type: 'text',
          localized: true,
          label: 'Etichetta',
        },
        {
          name: 'description',
          type: 'text',
          localized: true,
          label: 'Descrizione',
        },
      ],
    },
  ],
  timestamps: true,
}
