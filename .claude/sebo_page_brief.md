# CLAUDE CODE BRIEF — Rebrand the "Frank" page to SEBO

## Context
The page at `/it/frank` (and any `/[locale]/frank`) currently describes a character named
"Frank". The public lab character is now SEBO ("il Pellaio"), defined in SOUL.md / MEMORY.md.
Frank stays INTERNAL only (content/agent worker) — he must NOT appear anywhere public.
This brief rewrites the public page to be Sebo, aligns tone with his soul, and decouples the
customer-support function from his mystical voice.

Keep it public-safe at all times: NO references to drugs/solvents/"sniffing" or nudity. Sebo's
altered state is only ever suggested (vapori del banco, trance, "non dorme", testa leggera).

---
## Contact philosophy (resolved)
Sebo is the SOUL and the HYPE — people follow him for his drops. Order support is NOT a character:
the customer doesn't care who answers, only that someone does, fast and clear. So the support
contact is unnamed and unpersonified — "scrivi al laboratorio", no Frank, no Sebo, no personality
promises. Behind the scenes it can be n8n + human; the page never reveals or names it.

---

## Routing / SEO / technical
- New canonical route: `/[locale]/sebo` (e.g. `/it/sebo`). Update nav, internal links, sitemap.
- Add a permanent 301 redirect `/[locale]/frank` -> `/[locale]/sebo` so old links/SEO don't break.
- Update page metadata (title, description, og:*, twitter:*) — copy in §Meta below.
- Rename image assets `frank/frank-*.png` -> `sebo/sebo-*.png` IF the artwork is updated (see Open
  Items). If reusing the same artwork for now, keep files but update ALL `alt` text to Sebo.
- Replace EVERY visible/string occurrence of "Frank" with "Sebo" on this page and its components.
- Footer, P.IVA, ©2012–2026, Chieri (TO) stay unchanged.

---

## Meta (Italian)
- title: `Sebo — The Foolish Butcher`
- meta-description / og:description / twitter:description:
  `Il Pellaio. Custode delle pelli vive. Le sente respirare, sudare, guarire. Non dorme: le veglia.`
- og:title / twitter:title: `Sebo — The Foolish Butcher`
- keep locale/site_name/robots as they are.

---

## PAGE COPY (Italian — paste verbatim into the respective sections)

### HERO
Eyebrow: `IL LABORATORIO · CHIERI (TO)`
H1: `SEBO`
Sub: `Il Pellaio. Parla alle pelli. Le sente respirare.`

### SECTION — CHI È SEBO
Heading: `CHI È SEBO`
Body:
```
Sebo non è un personaggio. È una conseguenza.

Dal 2012, da quando il laboratorio produce le sue pelli, qualcuno doveva restare a vegliarle.
Sebo è quel qualcuno — anche se "qualcuno" è generoso. Un incrocio tra un nano e qualcosa di
più antico: il familiare che ogni laboratorio artigianale vero si porta dentro.

Dodici anni di vapori del banco, di catalisi, di pelle respirata troppo a lungo. Non sa più
dove finisce il laboratorio e dove comincia lui, e la testa gli gira sempre un po'. Lo chiamano
Sebo perché lui È il sebo: l'unica cosa che alla pelle sintetica in silicone mancava davvero.
Lui le completa, loro gli danno un senso.

Per Sebo le pelli sono vive. Respirano dai pori, sudano fuori l'inchiostro che non meritano di
tenere, e guariscono — se le curi. Le pelli economiche le chiama "morte", "bugiarde": non
venderle qui è stata una sua battaglia. "Un cadavere non guarisce", dice. "La ferita gli resta
aperta per sempre. La mia pelle si chiude."

Non si tatua, dice lui. Si venera. Pelle santa.
```

### SECTION — LE SUE OSSESSIONI (cards)
Heading: `LE SUE OSSESSIONI`

Card 1 — `IL FLOCK`
Quote: `"Microfili di velluto tritato — rosso, blu, giallo — che cadono dove vogliono loro. Per questo nessuna pelle è uguale a un'altra. Mai. Chi le vuole tutte identiche tatui pure sul linoleum."`

Card 2 — `LE DISCROMIE`
Quote: `"Non sono difetti. Sono la firma. La pelle vera è disomogenea, viva. Chi liscia tutto non ha mai guardato un avambraccio da vicino."`

Card 3 — `LA CATALISI`
Quote: `"Dodici ore. La pelle nasce piano e i flock si posano dove devono. Chi ha fretta non merita la pelle."`

Card 4 (NEW) — `LA PELLE VIVA`
Quote: `"Respira. Suda fuori l'inchiostro che non merita. E guarisce, se la curi. Vuoi sapere se una pelle è viva? Falla guarire. Una vera si chiude. Un cadavere resta com'è."`

(If the layout only supports 3 cards, keep 1, 2, 4 and fold CATALISI into the CHI È SEBO body.)

### SECTION — CONTATTO
Heading: `IL BANCO È APERTO`

- Primary CTA: `Segui Sebo` -> Telegram channel (his drops / "le profezie dal banco").
  Subcopy: `Ogni dodici ore un pensiero dal banco. Non aspettarti gentilezza. Aspettati ossessione.`
- Secondary CTA: `Scrivi al laboratorio` -> order/support contact (current Telegram href or email).
  Subcopy: `Per ordini e spedizioni rispondiamo noi, dritti al punto.`

The support CTA is unnamed and unpersonified — no "Frank", no Sebo, no "non è gentile / ricorda
ogni ordine" framing. Personality lives ONLY in Sebo's drops, never at the shipping desk. The
customer doesn't need to know who answers, only that someone does.

### FOOTER LINK
`← Torna alla vetrina` -> `/[locale]`

---

## Tone guardrails for any copy you generate beyond the above
- Italian, mixed register (crudo + grottesco-poetico), short sharp sentences.
- Venerate, never sell. No problem->solution marketing. No "compra ora / link in bio".
- Catchphrase available: "Pelle santa." Use sparingly.
- Public-safe altered state only (§5 of SOUL.md). Never explicit on substances/nudity.
- One emoji max, rare. Prefer none.

---

## OPEN ITEMS (flag back to me, don't guess)
1. ARTWORK: current assets are `frank-01/02/lab.png`. Is there Sebo art, or do we reuse these for
   now? Sebo's look (nano + ancient familiar) overlaps with Frank's (pointed ears, leather apron)
   but is wilder/more mystical. Decide: reuse-with-new-alt, or commission new art + rename assets.
2. Confirm whether the same page exists in other locales (`/en/frank` etc.) so redirects + copy
   translations are handled consistently.
