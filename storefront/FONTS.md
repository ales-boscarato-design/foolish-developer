# Storefront fonts

The storefront vendors the exact WOFF2 files and `@font-face` CSS emitted by the baseline Next.js `next/font/google` build. Runtime/build code does not fetch font files. `src/app/google-fonts.css` contains the baseline faces and original `unicode-range`, weight, style and `font-display` descriptors; its font URLs resolve only to `public/fonts/google/`.

- Outfit: normal, variable weight 100–900; both baseline Unicode faces are retained.
- Cormorant Garamond: normal and italic, weights 300/400/500/600/700; all five baseline Unicode faces per weight/style are retained.
- The baseline `latin` subset is preserved as the three original preload WOFF2 files emitted in the Google font manifest.
- Fallback faces, metric overrides, CSS family variables and `display: swap` are copied from the generated baseline CSS.

`FONTS-EVIDENCE.md` records the online baseline build, exact generated CSS/face fingerprints, hashes of every baseline WOFF2 file, preload mapping, network probe and offline gate results. Run `npm run verify:fonts` after `npm run build`: `scripts/verify-font-assets.py` checks source linkage, compiled CSS, binary checksums and font descriptors, then starts the production server and checks the fetched linked CSS plus actual rendered preload HTML. The CI workflow invokes this storefront-only check immediately after the storefront build; it does not change CMS/B2B jobs. `scripts/test-font-contract.py` contains negative regressions for missing CSS import/compiled faces and suppressed SSR preloads.

## Provenance and licensing

The corresponding upstream font sources are Google Fonts repository commit [`f391eb5d1f3c7d64eab1bf992b1aee045ac48ffb`](https://github.com/google/fonts/tree/f391eb5d1f3c7d64eab1bf992b1aee045ac48ffb):

- Outfit: [`ofl/outfit/Outfit[wght].ttf`](https://github.com/google/fonts/blob/f391eb5d1f3c7d64eab1bf992b1aee045ac48ffb/ofl/outfit/Outfit%5Bwght%5D.ttf)
- Cormorant Garamond: [`ofl/cormorantgaramond/CormorantGaramond[wght].ttf`](https://github.com/google/fonts/blob/f391eb5d1f3c7d64eab1bf992b1aee045ac48ffb/ofl/cormorantgaramond/CormorantGaramond%5Bwght%5D.ttf) and [`CormorantGaramond-Italic[wght].ttf`](https://github.com/google/fonts/blob/f391eb5d1f3c7d64eab1bf992b1aee045ac48ffb/ofl/cormorantgaramond/CormorantGaramond-Italic[wght].ttf)

The local WOFF2 assets are the actual subset binaries emitted when Next built those Google font definitions, not independently downloaded or substituted fonts. Both families carry the SIL Open Font License 1.1 (OFL), permitting web embedding and redistribution subject to its terms. Exact upstream license texts are included at `public/fonts/OFL-Outfit.txt` and `public/fonts/OFL-Cormorant-Garamond.txt`.
