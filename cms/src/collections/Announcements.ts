import type { CollectionConfig } from 'payload'

export const Announcements: CollectionConfig = {
  slug: 'announcements',
  admin: {
    useAsTitle: 'title',
    description: 'Annunci e comunicazioni per i rivenditori. Mantieni un solo annuncio attivo alla volta.',
    defaultColumns: ['title', 'active', 'startDate', 'endDate', 'updatedAt'],
    group: 'Marketing',
  },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'Titolo (visibile nel banner)',
      admin: { description: 'Es. "Ordina entro il 31 luglio — consegna a settembre + 5% extra"' },
    },
    {
      name: 'body',
      type: 'textarea',
      label: 'Testo breve (banner)',
      admin: { description: '1–2 righe mostrate nel banner del catalogo.' },
    },
    {
      name: 'content',
      type: 'textarea',
      label: 'Contenuto completo (pagina /offerte)',
      admin: {
        description: 'Testo esteso della comunicazione: condizioni, date, pagamento anticipato, ecc. Vai a capo per separare i paragrafi.',
        rows: 12,
      },
    },
    {
      name: 'startDate',
      type: 'date',
      label: 'Data inizio visibilità',
      admin: { description: 'Lascia vuoto per mostrare subito.' },
    },
    {
      name: 'endDate',
      type: 'date',
      label: 'Data fine visibilità',
      admin: { description: 'Lascia vuoto per non scadere mai.' },
    },
    {
      name: 'active',
      type: 'checkbox',
      required: true,
      defaultValue: false,
      label: 'Attivo',
      admin: { description: 'Deve essere true perché il banner appaia.' },
    },
    // ── Traduzioni ──────────────────────────────────────────────────────────
    {
      name: 'titleEn',
      type: 'text',
      label: 'Titolo (EN)',
      admin: { description: 'Se vuoto, usa il titolo italiano come fallback.' },
    },
    {
      name: 'bodyEn',
      type: 'textarea',
      label: 'Testo breve (EN)',
    },
    {
      name: 'contentEn',
      type: 'textarea',
      label: 'Contenuto completo (EN)',
      admin: { rows: 12 },
    },
    {
      name: 'titleFr',
      type: 'text',
      label: 'Titolo (FR)',
      admin: { description: 'Se vuoto, usa il titolo italiano come fallback.' },
    },
    {
      name: 'bodyFr',
      type: 'textarea',
      label: 'Testo breve (FR)',
    },
    {
      name: 'contentFr',
      type: 'textarea',
      label: 'Contenuto completo (FR)',
      admin: { rows: 12 },
    },
    {
      name: 'titleEs',
      type: 'text',
      label: 'Titolo (ES)',
      admin: { description: 'Se vuoto, usa il titolo italiano come fallback.' },
    },
    {
      name: 'bodyEs',
      type: 'textarea',
      label: 'Testo breve (ES)',
    },
    {
      name: 'contentEs',
      type: 'textarea',
      label: 'Contenuto completo (ES)',
      admin: { rows: 12 },
    },
  ],
}
