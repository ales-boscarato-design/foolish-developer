# Arricchimento Landing Abbonamento — Design Spec

**Data:** 2026-07-16
**Scope:** `foolish-storefront/storefront/` — solo le pagine prodotto abbonamento
**Obiettivo:** Le landing `/[locale]/abbonamento/tattoo` e `/[locale]/abbonamento/pmu` (spec precedente: `2026-07-15-abbonamento-pelle-mensile-design.md`) mostrano oggi solo la prima immagine del prodotto, nessuna descrizione, e la sola roadmap benefici — feedback post-deploy: troppo scarne. Arricchirle con galleria immagini vera, descrizione prodotto e una sezione FAQ.

---

## Problema attuale

`storefront/src/app/[locale]/abbonamento/[plan]/page.tsx` (Task 12 della feature precedente) renderizza:
- `product.images?.[0]?.image?.url` — solo la prima immagine, nessun modo di vedere le altre anche se la galleria del prodotto ne contiene di più
- `product.shortDescription` — un solo rigo, non la descrizione ricca (`product.description`, campo Lexical rich text)
- La `SubscriptionRoadmap` — unica sezione di contenuto oltre a foto+CTA

Manca qualunque spiegazione di *perché* conviene abbonarsi, *come* funziona il ciclo di fatturazione, e *se/come* si disdice.

---

## Galleria immagini

Nuovo componente `storefront/src/components/SubscriptionGallery.tsx` (client component):
- Riceve `images: ProductImage[]` (stesso tipo già esportato da `lib/cms.ts`)
- Layout: immagine principale grande + riga di thumbnail cliccabili sotto (se >1 immagine); se 1 sola immagine, solo quella, nessuna thumbnail
- Stile: sfondo `var(--card)`, bordo attivo `var(--accent)` sulla thumbnail selezionata — stesso trattamento cromatico della `SubscriptionRoadmap` (oro su sfondo scuro)
- **Non riusa/modifica `ProductDetail.tsx`**: quel componente gestisce anche varianti/carrello per l'acquisto singolo, già in produzione — costruiamo un componente nuovo e più semplice (solo immagini, nessun video/swipe gesture necessari) invece di rischiare la pagina prodotto esistente. Piccola duplicazione del pattern "thumbnail + immagine attiva" accettata, coerente con come questo codebase già duplica helper piccoli altrove piuttosto che condividerli.

## Descrizione prodotto

Nella pagina `[plan]/page.tsx`, sotto il nome prodotto, aggiungere `<RichText content={product.description} />` (componente già esistente e riusato da `ProductDetail.tsx`, nessuna modifica necessaria a `RichText` stesso). Va mostrata solo se `product.description` non è null.

## Sezione FAQ

Nuovo blocco nella stessa pagina, sotto la `SubscriptionRoadmap`, con 6 domande/risposte (uguali per entrambi i piani, non serve differenziare tattoo/pmu):

1. **Come funziona l'abbonamento?** — Addebito mensile automatico via Stripe, stessa referenza ogni mese, nessuna azione richiesta dopo l'iscrizione.
2. **Posso disdire quando voglio?** — Sì, in qualsiasi momento dall'area account, senza penali. Resti abbonato fino alla fine del periodo già pagato.
3. **Se disdico e poi mi riabbono, riparto da dove?** — Sempre dal mese 1: nessuno storico dei mesi precedenti viene mantenuto.
4. **Posso cambiare la zona di spedizione (Italia/Europa) a metà abbonamento?** — Sì, dall'area account, senza perdere i progressi già maturati.
5. **Cosa succede se il pagamento fallisce?** — Stripe riprova automaticamente l'addebito secondo la sua policy standard.
6. **Posso avere sia l'abbonamento Tattoo che quello PMU insieme?** — Sì, sono due abbonamenti indipendenti, attivabili in parallelo.

Layout: lista semplice domanda (grassetto, colore `var(--foreground)`) + risposta (`var(--muted-fg)`), separatore `var(--border)` tra le voci — coerente con lo stile editoriale del resto del sito, nessun accordion JS necessario (è contenuto breve, non serve collassare).

Le 6 coppie domanda/risposta vanno tradotte naturalmente nei 5 file `messages/{it,en,de,fr,es}.json`, come 6 coppie di chiavi piatte `faqQ1`/`faqA1` … `faqQ6`/`faqA6` sotto `subscription.product` (stesso stile flat-key già usato per le altre chiavi in quel blocco), lette con `getTranslations('subscription.product')` come il resto della pagina.

## Struttura pagina finale

```
[Galleria immagini]  |  [Nome prodotto]
                     |  [Descrizione (RichText)]
                     |  [Selettore zona + email + CTA abbonati]
---
[SubscriptionRoadmap — invariata]
---
[FAQ — 6 domande/risposte]
```

## Fuori scope

- La pagina hub (`/[locale]/abbonamento`) resta invariata — è un indice leggero verso le due pagine prodotto, non necessita dello stesso arricchimento.
- Nessuna modifica a `ProductDetail.tsx`, `Products.ts` (CMS), o alla logica di prezzo/abbonamento — solo presentazione.
- Nessun video nella galleria abbonamento (anche se il prodotto ne avesse uno) — fuori scope, solo immagini.
