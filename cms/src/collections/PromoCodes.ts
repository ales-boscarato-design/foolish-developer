import type { CollectionConfig } from 'payload'
import { PROMO_TYPES, PROMO_TYPE_LABELS } from './promoTypes'

export const PromoCodes: CollectionConfig = {
  slug: 'promo-codes',
  admin: {
    useAsTitle: 'code',
    defaultColumns: ['code', 'type', 'active', 'expiresAt'],
    group: 'Foolish Pro',
  },
  access: {
    read: () => true,
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc }) => {
        if (data.code && typeof data.code === 'string') {
          data.code = data.code.toUpperCase().trim()
        }
        const type = data.type ?? originalDoc?.type
        if (type === 'percent_tiered') {
          // `?? ` tratterebbe un null esplicito come "campo assente": un update che
          // azzera una soglia passerebbe la validazione salvando NULL. Qui conta la
          // presenza della chiave, non la verita' del valore.
          const pick = (key: 'minSubtotalCents' | 'tier2SubtotalCents' | 'discountPercent' | 'tier2DiscountPercent') =>
            key in data ? data[key] : originalDoc?.[key]
          const min = pick('minSubtotalCents')
          const tier2 = pick('tier2SubtotalCents')
          const percent1 = pick('discountPercent')
          const percent2 = pick('tier2DiscountPercent')
          if (
            !Number.isSafeInteger(min) || (min as number) <= 0
            || !Number.isSafeInteger(tier2) || (tier2 as number) <= (min as number)
            || typeof percent1 !== 'number' || !Number.isFinite(percent1) || percent1 <= 0 || percent1 > 100
            || typeof percent2 !== 'number' || !Number.isFinite(percent2) || percent2 <= 0 || percent2 > 100
            // Sconto progressivo: il secondo livello deve essere MAGGIORE del primo,
            // altrimenti un errore di configurazione darebbe meno sconto a chi compra di piu'.
            || percent2 <= percent1
          ) throw new Error('Configurazione sconto progressivo non valida')
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'code',
      type: 'text',
      required: true,
      unique: true,
      label: 'Codice',
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
          return 'Il codice promo deve contenere solo lettere, numeri, _ o - (1–64 caratteri)'
        }
        return true
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      label: 'Tipo',
      options: PROMO_TYPES.map((value) => ({ label: PROMO_TYPE_LABELS[value], value })),
    },
    {
      name: 'discountPercent',
      type: 'number',
      label: 'Percentuale sconto (%)',
      admin: {
        condition: (data) => data.type === 'percent' || data.type === 'percent_tiered',
        description: 'Es. 20 per il 20% di sconto',
      },
    },
    {
      name: 'discountAmount',
      type: 'number',
      label: 'Importo sconto (€)',
      admin: {
        condition: (data) => data.type === 'amount',
        description: 'Es. 15 per €15 di sconto',
      },
    },
    {
      name: 'minSubtotalCents',
      type: 'number',
      label: 'Subtotale minimo (centesimi)',
      admin: { condition: (data) => data.type === 'percent_tiered' },
    },
    {
      name: 'tier2SubtotalCents',
      type: 'number',
      label: 'Soglia secondo livello (centesimi)',
      admin: { condition: (data) => data.type === 'percent_tiered' },
    },
    {
      name: 'tier2DiscountPercent',
      type: 'number',
      label: 'Percentuale secondo livello (%)',
      admin: { condition: (data) => data.type === 'percent_tiered' },
    },
    { name: 'active', type: 'checkbox', defaultValue: true, label: 'Attivo' },
    {
      name: 'expiresAt',
      type: 'date',
      label: 'Scadenza',
      admin: {
        description: 'Lascia vuoto per codice senza scadenza',
        date: { pickerAppearance: 'dayOnly', displayFormat: 'dd/MM/yyyy' },
      },
    },
    {
      name: 'proMember',
      type: 'relationship',
      relationTo: 'pro-members' as 'users',
      required: false,
      label: 'Membro Pro',
    },
    {
      // Campo storico: nessun codice lo incrementa (il checkout non scrive su PromoCodes).
      // Resta per compatibilita' con i documenti e gli export esistenti: il valore non e'
      // affidabile e non va usato come conteggio. L'utilizzo reale si calcola contando gli
      // ordini che hanno questo codice in `orders.promoCode`.
      name: 'usageCount',
      type: 'number',
      defaultValue: 0,
      label: 'Utilizzi (storico, non aggiornato)',
      admin: {
        readOnly: true,
        description:
          'Campo storico: nessun codice lo incrementa, quindi il valore può non riflettere la realtà. '
          + 'Per l’utilizzo reale conta gli ordini in Ordini con questo codice nel campo "Codice promo".',
      },
    },
  ],
  timestamps: true,
}
