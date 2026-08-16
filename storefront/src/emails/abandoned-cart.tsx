import {
  Html, Head, Body, Container, Section, Text, Button, Hr, Preview,
} from 'react-email'
import { getEmailCopy, type EmailCopy } from './copy'

interface CartItem {
  productName: string
  variantLabel: string
  price: number
  quantity: number
}

interface Props {
  cartData: unknown
  locale: string
  unsubscribeUrl: string
  checkoutUrl: string
}
function getCopy(locale: string): EmailCopy['abandoned_cart'] {
  return getEmailCopy(locale).abandoned_cart
}

function getFooter(locale: string): EmailCopy['footer'] {
  return getEmailCopy(locale).footer
}

export function AbandonedCartEmail({ cartData, locale, unsubscribeUrl, checkoutUrl }: Props) {
  const copy = getCopy(locale)
  const footer = getFooter(locale)
  const items = Array.isArray(cartData) ? (cartData as CartItem[]) : []

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{copy.preview}</Preview>
      <Body style={{ backgroundColor: '#0a0a0a', fontFamily: 'Georgia, serif', margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: '560px', margin: '0 auto', padding: '40px 24px' }}>
          <Section>
            <Text style={{ color: '#c8a97e', fontSize: '13px', letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 24px' }}>
              The Foolish Butcher
            </Text>
          </Section>
          <Hr style={{ borderColor: '#c8a97e', borderWidth: '1px', margin: '0 0 32px' }} />
          <Section>
            <Text style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 'bold', margin: '0 0 20px', lineHeight: '1.3' }}>
              {copy.heading}
            </Text>
            <Text style={{ color: '#f0ede8', fontSize: '15px', lineHeight: '1.7', margin: '0 0 24px' }}>
              {copy.body}
            </Text>
            {items.length > 0 && (
              <Section style={{ backgroundColor: '#111', borderRadius: '6px', padding: '16px', marginBottom: '28px' }}>
                {items.map((item, i) => (
                  <Text key={i} style={{ color: '#f0ede8', fontSize: '13px', margin: '0 0 6px' }}>
                    {item.productName} — {item.variantLabel} × {item.quantity}
                    <span style={{ color: '#c8a97e' }}> €{(item.price * item.quantity).toFixed(2)}</span>
                  </Text>
                ))}
              </Section>
            )}
            <Button
              href={checkoutUrl}
              style={{
                backgroundColor: '#c8a97e',
                color: '#080808',
                padding: '14px 28px',
                borderRadius: '4px',
                fontSize: '13px',
                fontWeight: 'bold',
                letterSpacing: '0.06em',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              {copy.cta}
            </Button>
            {copy.footer_note && (
              <Text style={{ color: '#6b6560', fontSize: '12px', marginTop: '24px' }}>
                {copy.footer_note}
              </Text>
            )}
          </Section>
          <Hr style={{ borderColor: '#2a2a2a', borderWidth: '1px', margin: '40px 0 20px' }} />
          <Section>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: '0 0 4px' }}>
              {footer.site}
            </Text>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: 0 }}>
              {footer.unsubscribe_text}{' '}
              <a href={unsubscribeUrl} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                {footer.unsubscribe_cta}
              </a>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default AbandonedCartEmail
