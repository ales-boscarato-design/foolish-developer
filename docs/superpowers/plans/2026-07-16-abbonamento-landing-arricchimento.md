# Arricchimento Landing Abbonamento Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Arricchire le pagine prodotto abbonamento (`/[locale]/abbonamento/[plan]`) con galleria immagini navigabile, descrizione prodotto e una sezione FAQ.

**Architecture:** Un nuovo componente client `SubscriptionGallery` (thumbnail + immagine attiva, stato locale) sostituisce la singola `<img>` statica. La descrizione riusa il componente `RichText` già esistente. La FAQ è markup statico nella stessa pagina, testo da traduzioni.

**Tech Stack:** Next.js 15 (App Router), next-intl, React client component con `useState`.

## Global Constraints

- Riferimento: `docs/superpowers/specs/2026-07-16-abbonamento-landing-arricchimento-design.md`.
- Nessun test runner in questo repo. Verifica con `npx tsc --noEmit` e, dato che questa è una modifica visiva/di pagina, con controllo manuale in browser tramite gli strumenti di preview (screenshot/inspect) quando disponibili — se non disponibili in ambiente subagent, verifica statica (typecheck + lettura diff) e nota la limitazione.
- Non modificare `ProductDetail.tsx`, `Products.ts` (CMS), o la logica prezzo/abbonamento — solo presentazione sulle due pagine `/abbonamento/tattoo` e `/abbonamento/pmu`.
- Traduzioni naturali (non letterali) in tutte le 5 lingue — questo progetto ha già avuto errori di traduzione letterale in task precedenti di questa stessa feature, da evitare.

---

## File Structure

- `storefront/src/components/SubscriptionGallery.tsx` — nuovo. Galleria immagini per le pagine abbonamento.
- `storefront/src/app/[locale]/abbonamento/[plan]/page.tsx` — modificato. Usa la galleria, aggiunge `RichText` per la descrizione, aggiunge sezione FAQ.
- `storefront/messages/{it,en,de,fr,es}.json` — modificati. Nuove chiavi `subscription.product.faqTitle`, `faqQ1..faqQ6`, `faqA1..faqA6`.

---

### Task 1: Componente `SubscriptionGallery`

**Files:**
- Create: `storefront/src/components/SubscriptionGallery.tsx`

**Interfaces:**
- Consumes: `ProductImage` (tipo già esportato da `storefront/src/lib/cms.ts`, forma `{ image: { url: string; alt?: string; sizes?: ... }; alt?: string }`).
- Produces: `<SubscriptionGallery images={ProductImage[]} alt={string} />`. Usato dal Task 2.

- [ ] **Step 1: Scrivi il componente**

```typescript
// storefront/src/components/SubscriptionGallery.tsx
'use client'
import { useState } from 'react'
import type { ProductImage } from '@/lib/cms'

interface Props {
  images: ProductImage[]
  alt: string
}

export function SubscriptionGallery({ images, alt }: Props) {
  const [active, setActive] = useState(0)
  const activeImage = images[active]

  return (
    <div>
      <div className="relative aspect-square rounded overflow-hidden" style={{ background: 'var(--muted)' }}>
        {activeImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={activeImage.image.url} alt={activeImage.alt ?? alt} className="w-full h-full object-cover" />
        )}
      </div>
      {images.length > 1 && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
          {images.map((img, i) => (
            <button
              key={img.image.url + i}
              onClick={() => setActive(i)}
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '4px',
                overflow: 'hidden',
                padding: 0,
                border: `2px solid ${i === active ? 'var(--accent)' : 'var(--border)'}`,
                background: 'var(--muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.image.url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add storefront/src/components/SubscriptionGallery.tsx
git commit -m "feat(storefront): componente galleria immagini per pagine abbonamento"
```

---

### Task 2: Integra galleria, descrizione e FAQ nella pagina prodotto

**Files:**
- Modify: `storefront/src/app/[locale]/abbonamento/[plan]/page.tsx`
- Modify: `storefront/messages/{it,en,de,fr,es}.json`

**Interfaces:**
- Consumes: `SubscriptionGallery` (Task 1), `RichText` (componente esistente in `storefront/src/components/RichText.tsx`, prop `content: unknown`, già usato da `ProductDetail.tsx:951` come `<RichText content={product.description} />` senza guardia null — segui lo stesso pattern).

- [ ] **Step 1: Aggiungi le nuove chiavi di traduzione**

In `storefront/messages/it.json`, dentro il blocco `subscription.product` esistente (dove ci sono già `tabIt`, `cycle1`, ecc.), aggiungi:

```json
"faqTitle": "Domande frequenti",
"faqQ1": "Come funziona l'abbonamento?",
"faqA1": "Addebito mensile automatico via Stripe, stessa referenza ogni mese, nessuna azione richiesta dopo l'iscrizione.",
"faqQ2": "Posso disdire quando voglio?",
"faqA2": "Sì, in qualsiasi momento dall'area account, senza penali. Resti abbonato fino alla fine del periodo già pagato.",
"faqQ3": "Se disdico e poi mi riabbono, riparto da dove?",
"faqA3": "Sempre dal mese 1: nessuno storico dei mesi precedenti viene mantenuto.",
"faqQ4": "Posso cambiare la zona di spedizione (Italia/Europa) a metà abbonamento?",
"faqA4": "Sì, dall'area account, senza perdere i progressi già maturati.",
"faqQ5": "Cosa succede se il pagamento fallisce?",
"faqA5": "Stripe riprova automaticamente l'addebito secondo la sua policy standard.",
"faqQ6": "Posso avere sia l'abbonamento Tattoo che quello PMU insieme?",
"faqA6": "Sì, sono due abbonamenti indipendenti, attivabili in parallelo."
```

Ripeti per `en.json`, `de.json`, `fr.json`, `es.json` con traduzioni naturali (non letterali) delle stesse 6 domande/risposte, nello stesso registro editoriale già usato nelle chiavi esistenti di quel blocco in ciascun file.

- [ ] **Step 2: Aggiorna la pagina**

In `storefront/src/app/[locale]/abbonamento/[plan]/page.tsx`:

Aggiungi gli import:
```typescript
import { SubscriptionGallery } from '@/components/SubscriptionGallery'
import { RichText } from '@/components/RichText'
```

Sostituisci il blocco della singola immagine:
```typescript
        <div className="relative aspect-square rounded overflow-hidden" style={{ background: 'var(--muted)' }}>
          {firstImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={firstImage} alt={product.name} className="w-full h-full object-cover" />
          )}
        </div>
```
con:
```typescript
        <SubscriptionGallery images={product.images} alt={product.name} />
```

Rimuovi la riga `const firstImage = product.images?.[0]?.image?.url` (non più necessaria).

Aggiungi la descrizione ricca subito dopo lo `shortDescription` esistente:
```typescript
          <p className="text-sm mb-6" style={{ color: 'var(--muted-fg)' }}>{product.shortDescription}</p>
          <RichText content={product.description} />
```

Aggiungi la sezione FAQ dopo il blocco `<SubscriptionRoadmap ... />` esistente, prima della chiusura del div principale:
```typescript
      <div style={{ marginTop: '64px', maxWidth: '640px' }}>
        <h2 className="font-artisan text-2xl mb-6">{t('faqTitle')}</h2>
        {([1, 2, 3, 4, 5, 6] as const).map((n) => (
          <div key={n} style={{ padding: '20px 0', borderBottom: n < 6 ? '1px solid var(--border)' : 'none' }}>
            <p style={{ color: 'var(--foreground)', fontWeight: 600, marginBottom: '6px' }}>{t(`faqQ${n}`)}</p>
            <p style={{ color: 'var(--muted-fg)', fontSize: '14px' }}>{t(`faqA${n}`)}</p>
          </div>
        ))}
      </div>
```

- [ ] **Step 3: Verifica di tipo**

Run: `cd storefront && npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Valida i 5 file JSON**

Run:
```bash
for l in it en de fr es; do node -e "JSON.parse(require('fs').readFileSync('messages/$l.json'))" && echo "$l.json OK"; done
```
Expected: `OK` per tutti e 5.

- [ ] **Step 5: Verifica manuale in browser (se hai accesso a un dev server)**

Apri `/it/abbonamento/tattoo`. Expected: galleria con thumbnail cliccabili (se il prodotto reale ha più immagini), descrizione prodotto sotto lo short description, sezione FAQ con 6 domande sotto la roadmap. Se non hai un dev server disponibile in questo ambiente, salta questo step e segnalalo nel report invece di inventare un risultato — la verifica visiva verrà fatta da chi ha accesso al browser.

- [ ] **Step 6: Commit**

```bash
git add storefront/src/app/\[locale\]/abbonamento/\[plan\]/page.tsx storefront/messages
git commit -m "feat(storefront): galleria, descrizione e FAQ nelle pagine prodotto abbonamento"
```

---

## Dopo l'ultimo task

1. Typecheck completo: `cd storefront && npx tsc --noEmit`.
2. Se disponibile un ambiente di preview, controlla visivamente entrambe le pagine (`/abbonamento/tattoo`, `/abbonamento/pmu`) in italiano e almeno un'altra lingua.
3. Un solo `git push origin main` finale (regola del progetto — deploy automatico su Railway).
