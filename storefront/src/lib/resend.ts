import { Resend } from 'resend'
import { notifyNanobot } from '@/lib/nanobot'
import { SignJWT, jwtVerify } from 'jose'
import { render } from '@react-email/render'
import { WelcomeEmail } from '@/emails/welcome'
import { AbandonedCartEmail } from '@/emails/abandoned-cart'
import { ReviewRequestEmail } from '@/emails/review-request'
import { ReengagementEmail } from '@/emails/reengagement'
import { PwaInviteEmail } from '@/emails/pwa-invite'
import { getEmailCopy, type EmailCopy } from '@/emails/copy'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!)
}
const FROM = process.env.RESEND_FROM || 'The Foolish Butcher <ordini@updates.thefoolishbutcher.com>'
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

// Generate a signed JWT for unsubscribe links (365-day expiry).
export async function generateUnsubscribeToken(subscriberId: string, email: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.UNSUBSCRIBE_SECRET!)
  return new SignJWT({ subscriberId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('365d')
    .sign(secret)
}

// Review token: JWT firmato con REVIEW_SECRET, scadenza 30 giorni.
export async function generateReviewToken(params: {
  orderId: number
  productId: number
  productSlug: string
  subscriberId: string
}): Promise<string> {
  const secret = new TextEncoder().encode(process.env.REVIEW_SECRET!)
  return new SignJWT(params as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('30d')
    .sign(secret)
}

export async function verifyReviewToken(token: string): Promise<{
  orderId: number
  productId: number
  productSlug: string
  subscriberId: string
} | null> {
  try {
    const secret = new TextEncoder().encode(process.env.REVIEW_SECRET!)
    const { payload } = await jwtVerify(token, secret)
    return payload as { orderId: number; productId: number; productSlug: string; subscriberId: string }
  } catch {
    return null
  }
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
  const html = await render(WelcomeEmail({
    name: params.name,
    locale: params.locale,
    unsubscribeUrl: unsubscribeUrl(token),
  }))
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('welcome', params.locale),
    html,
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
  const html = await render(AbandonedCartEmail({
    cartData: params.cartData,
    locale: params.locale,
    unsubscribeUrl: unsubscribeUrl(token),
    checkoutUrl: `${SITE}/checkout`,
  }))
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('abandoned_cart', params.locale),
    html,
  })
  if (error) throw new Error(`Resend abandoned_cart error: ${error.message}`)
  return data!.id
}

export async function sendReviewRequestEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
  reviewUrl: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const html = await render(ReviewRequestEmail({
    name: params.name,
    locale: params.locale,
    unsubscribeUrl: unsubscribeUrl(token),
    reviewUrl: params.reviewUrl,
  }))
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: params.to,
    replyTo: 'alessandro@thefoolishbutcher.com',
    subject: getSubject('review_request', params.locale),
    html,
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
  const html = await render(ReengagementEmail({
    name: params.name,
    locale: params.locale,
    unsubscribeUrl: unsubscribeUrl(token),
    shopUrl: SITE,
  }))
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('reengagement', params.locale),
    html,
  })
  if (error) throw new Error(`Resend reengagement error: ${error.message}`)
  return data!.id
}

export async function sendPwaInviteEmail(params: {
  to: string
  name: string | null
  locale: string
  subscriberId: string
}): Promise<string> {
  const token = await generateUnsubscribeToken(params.subscriberId, params.to)
  const accountUrl = `${SITE}/account`
  const html = await render(PwaInviteEmail({
    name: params.name,
    locale: params.locale,
    accountUrl,
    unsubscribeUrl: unsubscribeUrl(token),
  }))
  const { data, error } = await getResend().emails.send({
    from: FROM,
    to: params.to,
    subject: getSubject('pwa_invite', params.locale),
    html,
  })
  if (error) throw new Error(`Resend pwa_invite error: ${error.message}`)
  return data!.id
}

// Notify Frank after each cron run.
export async function notifyFrank(payload: {
  cron: string
  sent: number
  recipients: string[]
  errors: string[]
}): Promise<void> {
  await notifyNanobot('/hooks/foolish-storefront-cron', payload)
}

// Helper: read subject line from locale copy.
function getSubject(type: string, locale: string): string {
  const copy = getEmailCopy(locale)
  const section = copy[type as keyof EmailCopy]
  return section && 'subject' in section && typeof section.subject === 'string'
    ? section.subject
    : '— The Foolish Butcher'
}
