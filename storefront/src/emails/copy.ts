import de from '../../emails/de.json'
import en from '../../emails/en.json'
import es from '../../emails/es.json'
import fr from '../../emails/fr.json'
import it from '../../emails/it.json'

export type EmailCopy = typeof it

const copies = { de, en, es, fr, it } satisfies Record<string, EmailCopy>

export function getEmailCopy(locale: string): EmailCopy {
  return copies[locale as keyof typeof copies] ?? copies.it
}
