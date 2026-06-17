import {
  Html, Head, Body, Container, Section, Text, Button, Hr, Preview, Link,
} from '@react-email/components'

interface Props {
  name: string | null
  locale: string
  unsubscribeUrl: string
}

interface Channel {
  before: string
  link: string
  url: string
  after: string
}

interface WelcomeCopy {
  subject: string
  preview: string
  heading: string
  body: string
  cta: string
  cta_url: string
  channels?: Channel[]
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
function getCopy(locale: string): WelcomeCopy {
  try { return require(`../../emails/${locale}.json`).welcome }
  catch { return require('../../emails/it.json').welcome }
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
function getFooter(locale: string): Record<string, string> {
  try { return require(`../../emails/${locale}.json`).footer }
  catch { return require('../../emails/it.json').footer }
}

export function WelcomeEmail({ name, locale, unsubscribeUrl }: Props) {
  const copy = getCopy(locale)
  const footer = getFooter(locale)
  const greeting = name ? name.split(' ')[0] : null

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
            {greeting && (
              <Text style={{ color: '#f0ede8', fontSize: '16px', margin: '0 0 8px' }}>
                {greeting},
              </Text>
            )}
            {copy.heading ? (
              <Text style={{ color: '#f0ede8', fontSize: '22px', fontWeight: 'bold', margin: '0 0 20px', lineHeight: '1.3' }}>
                {copy.heading}
              </Text>
            ) : null}
            <Text style={{ color: '#f0ede8', fontSize: '15px', lineHeight: '1.7', margin: '0 0 24px' }}>
              {copy.body}
            </Text>
            {copy.channels && (
              <Section style={{ margin: '0 0 32px' }}>
                {copy.channels.map((ch, i) => (
                  <Text key={i} style={{ color: '#f0ede8', fontSize: '14px', lineHeight: '1.8', margin: '0 0 4px' }}>
                    • {ch.before}
                    <Link href={ch.url} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                      {ch.link}
                    </Link>
                    {ch.after}
                  </Text>
                ))}
              </Section>
            )}
            <Button
              href={copy.cta_url}
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
          </Section>
          <Hr style={{ borderColor: '#2a2a2a', borderWidth: '1px', margin: '40px 0 20px' }} />
          <Section>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: '0 0 4px' }}>
              {footer.site}
            </Text>
            <Text style={{ color: '#6b6560', fontSize: '12px', margin: 0 }}>
              {footer.unsubscribe_text}{' '}
              <Link href={unsubscribeUrl} style={{ color: '#c8a97e', textDecoration: 'underline' }}>
                {footer.unsubscribe_cta}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export default WelcomeEmail
