import { Resend } from 'resend'
import { SignJWT } from 'jose'
import { WelcomeEmail } from '@/emails/welcome'
import { AbandonedCartEmail } from '@/emails/abandoned-cart'
import { ReviewRequestEmail } from '@/emails/review-request'
import { ReengagementEmail } from '@/emails/reengagement'

const resend = new Resend(process.env.RESEND_API_KEY!)
const FROM = process.env.RESEND_FROM || 'The Foolish Butcher <noreply@thefoolishbutcher.com>'
const SITE = 'https://thefoolishbutcher.com'

// Map shipping country → locale
export function countryToLocale(country: string | null | undefined): string {
  if (!country) return 'it'
  const c = country.toUpperCase()
  if (c === 'IT') return 'it'
  if (['DE', 'AT', 'CH'].includes(c)) return 'de'
  if (['FR', 'BE', 'LU'].includes(c)) return 'fr'
  if (['ES'].includes(c)) return 'es'
  return 'en'
}

// Generate a signed JWT for unsubscribe links (30-day expiry).
export async function generateUnsubscribeToken(subscriberId: string, email: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_SECRET!)
  return new SignJWT({ subscriberId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret)
}

function unsubscribeUrl(token: string): string {
  return `${SITE}/api/email/unsubscribe?token=${token}`
}

export async function sendWelcomeEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('welcome', params.locale),
    react: WelcomeEmail({
      name: params.name,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
    }),
  })
  if (error) throw new Error(`Resend welcome error: ${error.message}`)
  return data!.id
}

export async function sendAbandonedCartEmail(params: {
  to: string
  cartData: unknown
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('abandoned_cart', params.locale),
    react: AbandonedCartEmail({
      cartData: params.cartData,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
      checkoutUrl: `${SITE}/checkout`,
    }),
  })
  if (error) throw new Error(`Resend abandoned_cart error: ${error.message}`)
  return data!.id
}

export async function sendReviewRequestEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    replyTo: 'alessandro@thefoolishbutcher.com',
    subject: getSubject('review_request', params.locale),
    react: ReviewRequestEmail({
      name: params.name,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
    }),
  })
  if (error) throw new Error(`Resend review_request error: ${error.message}`)
  return data!.id
}

export async function sendReengagementEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('reengagement', params.locale),
    react: ReengagementEmail({
      name: params.name,
      locale: params.locale,
      unsubscribeUrl: unsubscribeUrl(token),
      shopUrl: SITE,
    }),
  })
  if (error) throw new Error(`Resend reengagement error: ${error.message}`)
  return data!.id
}

// Notify Frank after each cron run.
export async function notifyFrank(payload: {
  cron: string
  sent: number
  recipients: string[]
  errors: string[]
}): Promise<void> {
  const url = process.env.FRANK_WEBHOOK_URL
  if (!url) return
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => console.error('Frank notify failed:', e))
}

// Helper: read subject line from locale copy.
function getSubject(type: string, locale: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let copy: Record<string, Record<string, string>>
  try {
    copy = require(`../../emails/${locale}.json`)
  } catch {
    copy = require('../../emails/it.json')
  }
  return copy[type]?.subject ?? '— The Foolish Butcher'
}
