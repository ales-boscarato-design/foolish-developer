# Concept: Sebo & Il Pellaio — Site Refactor

**Project:** thefoolishbutcher.com (Next.js 14, IT locale primary)
**Scope:** Refactor `/it/sebo`, create `/it/laboratorio`, character separation, asset cleanup.
**Author:** Alessandro / brainstorm session 2026-06-10

---

## 1. Context & strategic decision

The Foolish Butcher is adopting a two-character brand system with **asymmetric exposure**:

- **Sebo (the rat)** — front-facing viral mascot. Image + text comedy format. Top of funnel: attention, shareability, stickers/merch. 90% of public exposure.
- **Il Pellaio (the gnome artisan)** — the craft voice. Bottom of funnel: product credibility, premium positioning, packaging, care guides. 10% exposure. No social feed of his own.

**Core principle:** no single character can be both the clown and the authority. Sebo sells attention; il Pellaio sells the product. They never swap roles.

**Current problem:** the live `/it/sebo` page contains il Pellaio's character and voice ("Custode delle pelli vive", flock/discromie/catalisi obsessions) under Sebo's name. This content is excellent product copy but belongs to il Pellaio.

---

## 2. Character bible (short)

### Sebo — the rat
- **Role:** the practice martyr. The worst portfolio in Italy. The one you ruin so you don't ruin a human. He *embodies* the practice skin (rat = lab animal = test subject).
- **Voice:** deadpan, self-deprecating, insider tattoo-world humor. Serene about being a disaster.
- **Comedic engine:** says what tattoo artists think but can't say. Territory: ~70% craft backstage (practice, mistakes, apprenticeship), ~20% broader tattoo world, ~10% explicit product.
- **Manifesto line:** *"Sbaglia su di me. Non su un cristiano."*
- **Never does:** praise product quality, sell, explain. The product is the stage of the joke, never the subject.

### Il Pellaio — the artisan
- **Role:** custodian of the skins. Makes them, venerates them, watches over the 12h catalysis. Treats skins as living, sacred.
- **Voice:** obsessive, poetic, severe, anti-commercial. Already fully written — it's the current `/it/sebo` copy.
- **Where he lives:** `/laboratorio` (about page), product pages, the print-in-the-box kit, care/healing guides. Rare guest appearances in Sebo's posts as the horrified straight man.
- **Never does:** jokes, memes, social presence of his own.

### The conflict (universe glue)
Il Pellaio creates and venerates the skins. Sebo exists to get them ruined. Il Pellaio will never forgive him. This tension IS the brand: skins made like artworks, sold to be massacred. Each page references the other exactly once, in conflict (see §4.3).

---

## 3. Information architecture changes

| Route | Action |
|---|---|
| `/it/sebo` | **Refactor.** Becomes the rat's page: manifesto hero + meme wall + stickers + CTA. Landing page for social traffic. |
| `/it/laboratorio` | **New.** Il Pellaio's page = the in-world "about" page. Receives ~all current `/it/sebo` content, reattributed. |
| Product pages | **Phase 2.** Il Pellaio's voice progressively becomes the product copy (flock, discromie, catalisi, pelle viva blocks reusable as components). |
| Nav | `/sebo` enters main nav as a destination. `/laboratorio` replaces/absorbs any "chi siamo". Rest of nav unchanged. |

**SEO/redirects:** keep `/it/sebo` URL (no redirect needed — page is repurposed). Update all meta (title, description, og, twitter): current meta describes il Pellaio and must move to `/laboratorio`. Write new Sebo meta around the manifesto + practice-skin mascot framing.

---

## 4. Page specs

### 4.1 `/it/sebo` — "lo show"

Structure top to bottom. The page should feel like a poster, not a website.

**A. Hero**
- Full-bleed image: Sebo lying on a tattoo bed like a client — paws behind head, serene expression, studio lamp on, machine on the tray. His body covered in the worst tattoos ever seen: shaky lines, a crooked heart reading "MAMM", lopsided lettering, a visible blowout.
- H1 (the manifesto, fixed brand font, overlay style consistent with the IG post format):

> **Sbaglia su di me. Non su un cristiano.**

- No subtitle. No CTA in the hero.

**B. Chi è Sebo** — three lines, in character:

> Mi chiamo Sebo. Sono il peggior portfolio d'Italia, e il motivo per cui il tuo non lo è.
> Ogni linea storta che porto addosso è un cliente salvato.
> Non sono un personaggio. Sono una conseguenza: dal 2012 qualcuno doveva pur farsi bucare.

**C. Il muro** — the core section.
- Responsive grid of Sebo's best posts (image + one-line caption). This is the living archive of the meme: social proof + SEO fuel.
- **Data source:** CMS-driven, updated automatically by Frank (nanobot CMS agent). For v1, implement as a content collection / JSON read at build or ISR; define a simple schema: `{ id, image, line, date, platform_url? }`. Frank integration is out of scope for this build — just make the schema and rendering ready.
- Each tile: image with the line as overlay or caption, optional link to the original post.

**D. Stickers**
- Merch section, even minimal: 3 sticker designs (the manifesto line first), "in arrivo" state acceptable if POD isn't wired yet.
- Rationale to preserve in design: the sticker closes the loop *battuta → sticker → postazione* (stickers on workstations = ads inside every studio).

**E. The Pellaio cross-link** — one line, near the footer of the page content:

> Il Pellaio fa le pelli. Io le rovino. Non mi rivolge la parola dal 2012. → [/laboratorio]

**F. CTA finale**
- Primary: Instagram (Sebo's feed — the format lives there).
- Secondary: Telegram channel (demoted from current primary position).
- Orders bot link stays as is.

### 4.2 `/it/laboratorio` — il Pellaio / the in-world about page

- Migrate the current `/it/sebo` content **verbatim where possible**, reattributed to il Pellaio: "Il Pellaio. Custode delle pelli vive…", the 2012 origin, the obsessions (IL FLOCK, LE DISCROMIE, LA CATALISI, LA PELLE VIVA) with their existing quotes and images.
- Adjust the origin paragraph: replace "Lo chiamano Sebo perché lui È il sebo…" naming logic with Pellaio-appropriate framing (the custodian who has breathed the bench vapors since 2012). Keep the tone untouched — this voice is the premium positioning.
- This page doubles as the company "chi siamo": footer/nav links that pointed to any about content point here.
- **The Sebo cross-link** — one line, at the bottom:

> Poi c'è Sebo. Preferirei non parlarne. → [/sebo]

- Keep the existing Telegram CTAs here if desired ("Segui o scrivi" block fits the Pellaio register better than Sebo's page).

### 4.3 Cross-link rule (both pages)
Exactly **one** mention of the other character per page, written in conflict, with link. No "meet our characters" section, no media-kit explanation anywhere. The visitor must infer the universe.

---

## 5. Design direction

- Inherit the existing site's visual system (typography, dark artisanal aesthetic) — this is a refactor, not a redesign. The two pages should be visibly siblings with opposite temperaments:
  - `/laboratorio`: quiet, dense, reverent. Long-form prose, generous whitespace, the existing lab photography.
  - `/sebo`: louder, poster-like, meme-native. The overlay text style on the hero must match the IG post template exactly (same font, same placement) so feed and site are one format.
- One signature element on `/sebo`: the manifesto hero treatment. Keep everything else disciplined; the wall grid stays clean so the jokes carry.
- Responsive down to mobile is non-negotiable: most traffic arrives from IG.

---

## 6. Technical notes

- **Asset naming cleanup:** current images are `frank-01.png`, `frank-02.png`, `frank-03.png`, `frank-lab.png`. Rename to `pellaio-*` (they depict il Pellaio) before the character split fossilizes wrong names in the codebase. New Sebo assets: `sebo-*`. Update all references.
- **Sebo hero image:** placeholder acceptable in v1 (final image comes from the ZUPPAZ LoRA pipeline). Build the layout against a 4:5 or 1:1 placeholder.
- **Meta tags:** see §3. Current `/it/sebo` meta description is Pellaio copy → move to `/laboratorio`; write new Sebo meta.
- **Wall schema:** keep it dumb and file/CMS-friendly so Frank can append entries without code changes.
- **i18n:** IT first. Mirror EN routes (`/en/sebo`, `/en/laboratorio`) only if the site already mirrors; copy translation is a separate task — do not machine-translate the character copy.

---

## 7. Out of scope (this build)

- Frank/nanobot automation wiring for the wall (schema only).
- POD/sticker checkout integration (static section with "in arrivo" is fine).
- Product page rewrite in Pellaio voice (Phase 2).
- LoRA image generation.

---

## 8. Acceptance criteria

1. `/it/sebo` shows: manifesto hero, 3-line bio, wall grid (≥6 seeded entries from schema), stickers section, Pellaio cross-link line, IG-primary CTA.
2. `/it/laboratorio` contains the migrated Pellaio content with corrected attribution, the obsessions blocks, and the Sebo cross-link line.
3. Each page references the other exactly once.
4. No `frank-*` asset names remain in the repo.
5. Meta tags correct per page; no Pellaio copy in Sebo's meta.
6. Mobile rendering verified for both pages.
