import { APIError } from 'payload'
import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from 'payload'

const AFFILIATE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function hasStorefrontSecret(req: PayloadRequest): boolean {
  const secret = req.headers?.get?.('x-storefront-secret') ?? (req.headers as unknown as Record<string, string>)?.['x-storefront-secret']
  return !!secret && secret === process.env.PAYLOAD_API_SECRET
}

function validateIntegerRange(label: string, min: number, max: number) {
  return (value: unknown) => {
    if (value === null || value === undefined) return true
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      return `${label} deve essere un intero tra ${min} e ${max}`
    }
    return true
  }
}

const validateAffiliatePromoCode: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  const promoCodeValue = Object.prototype.hasOwnProperty.call(data, 'promoCode') ? data.promoCode : originalDoc?.promoCode
  const promoCodeId =
    typeof promoCodeValue === 'object' && promoCodeValue !== null && 'id' in promoCodeValue
      ? promoCodeValue.id
      : promoCodeValue

  if ((typeof promoCodeId !== 'number' && typeof promoCodeId !== 'string') || promoCodeId === '') {
    throw new APIError('È necessario selezionare un codice promo valido.', 400)
  }

  const promoCode = await req.payload.findByID({
    collection: 'promo-codes',
    id: promoCodeId,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
    req,
  })

  if (!promoCode || promoCode.active !== true) {
    throw new APIError('Il codice promo affiliato deve esistere ed essere attivo.', 400)
  }

  if (promoCode.type !== 'percent') {
    throw new APIError('Il codice promo affiliato deve essere di tipo percentuale ordinario.', 400)
  }

  return data
}

export const Affiliates: CollectionConfig = {
  slug: 'affiliates',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'status', 'promoCode', 'updatedAt'],
    listSearchableFields: ['name', 'slug', 'contactEmail'],
    group: 'Marketing',
  },
  access: {
    // Affiliate identities and commission configuration are never public.
    read: ({ req }) => !!req.user || hasStorefrontSecret(req),
    create: ({ req }) => !!req.user,
    update: ({ req }) => !!req.user,
    delete: ({ req }) => !!req.user,
  },
  hooks: {
    beforeChange: [validateAffiliatePromoCode],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Persona / nome visualizzato',
      maxLength: 160,
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      label: 'Slug pubblico',
      admin: {
        description: 'Solo minuscole, numeri e trattini; deve iniziare e finire con una lettera o un numero.',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !AFFILIATE_SLUG_RE.test(value)) {
          return 'Lo slug deve contenere solo minuscole, numeri e trattini (1–63 caratteri)'
        }
        return true
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      label: 'Stato',
      options: [
        { label: 'Attivo', value: 'active' },
        { label: 'In pausa', value: 'paused' },
        { label: 'Archiviato', value: 'archived' },
      ],
    },
    {
      name: 'contactEmail',
      type: 'email',
      label: 'Email di contatto',
    },
    {
      name: 'promoCode',
      type: 'relationship',
      relationTo: 'promo-codes',
      required: true,
      unique: true,
      label: 'Codice promo dedicato',
      admin: {
        description: 'Un codice promo può essere assegnato a un solo affiliato.',
      },
    },
    {
      name: 'commissionBaseRateBps',
      type: 'number',
      required: true,
      defaultValue: 1500,
      label: 'Commissione base (bps)',
      validate: validateIntegerRange('La commissione base', 0, 10000),
    },
    {
      name: 'commissionStepRateBps',
      type: 'number',
      required: true,
      defaultValue: 300,
      label: 'Incremento commissione (bps)',
      validate: validateIntegerRange('L’incremento commissione', 0, 10000),
    },
    {
      name: 'commissionStepThresholdCents',
      type: 'number',
      required: true,
      defaultValue: 50000,
      label: 'Soglia incremento (centesimi)',
      validate: validateIntegerRange('La soglia commissione', 1, Number.MAX_SAFE_INTEGER),
    },
    {
      name: 'commissionMaxRateBps',
      type: 'number',
      required: true,
      defaultValue: 3800,
      label: 'Commissione massima (bps)',
      validate: validateIntegerRange('La commissione massima', 0, 10000),
    },
    {
      name: 'cookieWindowDays',
      type: 'number',
      required: true,
      defaultValue: 30,
      label: 'Finestra cookie (giorni)',
      validate: validateIntegerRange('La finestra cookie', 0, 3650),
    },
    {
      // Read-only list of the ledger rows attributed to this affiliate, so the
      // admin can see the sales a code generated without leaving the record.
      name: 'conversions',
      type: 'join',
      collection: 'affiliate-conversions',
      on: 'affiliate',
      label: 'Vendite attribuite',
      admin: {
        defaultColumns: [
          'stripeSessionId',
          'orderNumber',
          'eligibleAmountCents',
          'commissionRateBps',
          'commissionAmountCents',
          'paymentStatus',
          'paidAt',
        ],
        allowCreate: false,
      },
    },
  ],
  timestamps: true,
}
