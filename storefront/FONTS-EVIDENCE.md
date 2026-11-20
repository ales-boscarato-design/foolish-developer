# Font parity and offline verification evidence

Scope: `storefront/` only. No CMS/B2B edits. Evidence was produced in worktree `wt/t_f424c39b`; no commit, push, PR, merge or deployment was performed.

## Captured Google/Next baseline

To recover actual artifacts rather than infer Google subset behavior, the original `HEAD` `layout.tsx` and `globals.css` were temporarily restored in the worktree and built with the installed Next 16.3.1 toolchain, then the task files were restored before implementation:

```text
cd storefront && npm run build
exit: 0
```

The baseline CSS was `.next/static/chunks/2rke3q5w6sov0.css`, SHA-256 `fb914e8d1d2bbf2cb21a803a7fb43e8b0820eeadad53049d25466c40fdac47c4`. Its 54 relevant `@font-face` rules (52 primary faces + 2 fallback faces) were captured into `src/app/google-fonts.css`; only the asset URL changed from the generated `../media/...` path to its local `/fonts/google/...` path. The ordered face-set fingerprint, after normalizing URLs to their filenames, is `e3903a9c1157bd0abca81af602a4560621ea3600b58d95bb52f07a7dbf80c438` for both baseline and local CSS. A direct baseline-to-local verifier confirmed identical descriptors and Unicode ranges for all 54 rules.

Baseline face inventory:

- Outfit: 2 Unicode-range faces, normal, variable weight `100 900`.
- Cormorant Garamond: 5 Unicode-range faces × 5 weights × 2 styles = 50 faces; weights `300/400/500/600/700`, normal and italic.
- Fallbacks: Arial with ascent/descent/line-gap/size-adjust `100.18% / 26.05% / 0.0% / 99.82%`; Times New Roman with `95.27% / 29.59% / 0.0% / 96.98%`.
- Every primary face retains `font-display: swap`.
- The baseline `next-font-manifest.json` selected precisely these `latin` preload assets, in order: Outfit `1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2`, Cormorant italic `8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2`, Cormorant normal `01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2`. The layout emits local preload links for those same three files.
- CSS variables are preserved exactly: `--font-outfit: "Outfit", "Outfit Fallback"`; `--font-cormorant: "Cormorant Garamond", "Cormorant Garamond Fallback"`.

## Exact WOFF2 parity

The 12 assets below were copied byte-for-byte from `.next/static/media` produced by that baseline build. Before running the local offline build, a read-only comparison checked every source/copy pair and reported `source_exists=True sha256_equal=True` for all 12. The same checksums are pinned in `scripts/verify-font-assets.py`.

| Baseline WOFF2 file | Bytes | SHA-256 |
| --- | ---: | --- |
| `01e4147cff8141ee-s.p.3huc2loe0ie8a.woff2` | 37776 | `5d618c462b7a5b74f442e1548880086af71764d9cc7d35c16ab45353da934621` |
| `0926c12c4384550f-s.1-qpv3jvnkkyl.woff2` | 34444 | `06bc9a8c179afaf7dd5d3b4987ad2f4a82ca85a542c9e498b18bf32ad0257d8e` |
| `1b99372b3eaef0c8-s.p.1gsd1jahc5dg_.woff2` | 32228 | `92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12` |
| `1f9e983605289f29-s.3aak_kra40y8r.woff2` | 33740 | `9dc38267bdee93a653200ef3c1e8060e3f1399073432c415c683b419d3b50464` |
| `591574edbe85c69b-s.2cu8l7zf4s4ec.woff2` | 21264 | `3170a883f1968a2d1135259e40fd88508da70c20337e491f171f9405d0749053` |
| `8bd76523131fa0fc-s.p.1pvupmngxrt5z.woff2` | 39304 | `e6d6d1d73858aa9b66f3a3539f9dec22faab2276e61ad1d813bc04dd59c9c122` |
| `9cc5c0547f229dea-s.00y8kskkn0hyx.woff2` | 23408 | `d04439363ec805132dc6c6e6a925f76efe17646f9811af8e10e218ea3dba5335` |
| `acf349172f10b359-s.0gv8q2vqi14yg.woff2` | 11556 | `3512ad3b4ddd21fa75ab44296867da1f82948350ffba678a04afbb511015cb08` |
| `b0947914c9718a1e-s.1xjn85gt7t6qs.woff2` | 21132 | `d81372bae1f872f1418c0b7eb412f8a92a156a950fda8d2383701c75d38969df` |
| `b2ea385cb5ae8625-s.1spbknb88wd48.woff2` | 14760 | `9e38b3f1575daba3435ef09d33a202585ed5bd204bd0a8c744955c750c2b9091` |
| `d0b60be57f16ee32-s.1xtu7gopqv2u0.woff2` | 11264 | `826f73ca737feec0eb1004808629973d6b611fddc2bd2a689b5fe331f6be6427` |
| `d8cddd76dbfeaef0-s.1mblz1wog092a.woff2` | 25196 | `919a7720ae1671f06ebdd4f65bb9c2f0d619f81f805d85aec025c89139536292` |

This byte identity plus the full retained `unicode-range` rules preserves glyph selection. In particular, the Outfit Latin face's ranges include `U+2191` and `U+2193` but do not cover `U+2190` (←) or `U+2713` (✓); the verifier confirms those glyphs route to fallback as in the baseline rather than being rendered by a full-Unicode TTF.

## Reproducible verifier and source/network audit

```text
cd storefront && python3 scripts/verify-font-assets.py
PASS: 54 baseline @font-face rules and all unicode ranges fingerprint-match
PASS: Outfit variable 100–900; Cormorant Garamond 300–700 × normal/italic
PASS: all 12 WOFF2 assets match baseline SHA-256 values
PASS: three original latin preloads, fallback metrics, display:swap, variables
PASS: Outfit Google subsets route ← (U+2190) and ✓ (U+2713) to fallback
PASS: no next/font loader or Google Fonts URL in font runtime
```

A source scan of `storefront/src` for `next/font/google`, `fonts.googleapis.com`, and `fonts.gstatic.com` returned zero matches. `layout.tsx` imports no Next font loader; build-time font inputs are the checked-in CSS and local WOFF2s.

## Offline isolation and gates

Negative network probe was executed inside the exact required bubblewrap namespace:

```text
bwrap --dev-bind / / --unshare-net --die-with-parent python3 - <<'PY'
# connect to 1.1.1.1:443 and require the socket attempt to fail
PY
OSError [Errno 101] Network is unreachable
exit: 0 (expected denial observed)
```

Offline production build:

```text
cd storefront && bwrap --dev-bind / / --unshare-net --die-with-parent npm run build
exit: 0
```

After the final offline build, `npm run verify:fonts` and all 35 `test:*` storefront scripts, `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/eslint src`, `node scripts/release-gate.mjs`, and the network-isolation probe ran inside the required bubblewrap namespace. Result: **40/40 commands exit 0** (network probe + `verify:fonts` + 35 suites + typecheck + lint + release gate). Literal output is in ignored `storefront/google-baseline-build.log`, `storefront/font-build-final.log`, and `storefront/font-gates-final.log`.

## Independent-review regression fixes

The old verifier trusted source strings and asset hashes but did not require the CSS import to survive compilation or the preload expressions to appear in rendered HTML. It is now fail-closed at each actual boundary:

- `verify-font-assets.py` requires `globals.css` to import the font stylesheet and reads the generated `.next/static` CSS; it fails if the compiled faces/ranges are absent or changed.
- It starts the production Next server and requests `/it/privacy` (HTTP 200), parses the actual SSR HTML for exactly the three expected font preload links and their `as`/`type`/`crossorigin` attributes, then fetches the stylesheet linked by that HTML and verifies the compiled face fingerprint.
- `npm run verify:fonts` runs seven focused regression tests and the full source/compiled/runtime verifier. The GitHub workflow invokes it immediately after `Storefront — build`, because the check consumes `.next` artifacts. The workflow delta is limited to a storefront-only post-build step; CMS and B2B jobs are unchanged.

Red/green mutation run (each mutated source built with network disabled):

| Mutation | Build | `python3 scripts/verify-font-assets.py` |
| --- | ---: | ---: |
| Remove `@import "./google-fonts.css";` | exit 0 | exit 1, import/compiled font contract rejected |
| Change `fontPreloads.map(...)` to `false && fontPreloads.map(...)` | exit 0 | exit 1, production SSR HTML had 0 font preloads (expected 3) |
| Restore source | exit 0 | exit 0; rendered 200 HTML had all 3 preloads and linked CSS had all 54 baseline faces |

The two negative vectors are also permanent tests in `scripts/test-font-contract.py`; `npm run verify:fonts` passed all seven (including baseline positives and the two commented-variable cases). Full mutation/build output is in ignored `storefront/font-mutation-evidence.log`; final gate output is in `storefront/font-gates-final.log`.

## Effective variable contract and third-review regression

The compiled-CSS validator now strips CSS comments before parsing rules, checks the effective `:root`/`:host` declarations for both variables, and verifies the compiled consumers: `body` uses Outfit; `.font-display`, `.font-artisan`, and `.stat-number` use Cormorant Garamond. It also checks both local fallback faces and their exact `src`, ascent/descent/line-gap overrides, and `size-adjust`. Current `@theme inline` does not map either variable to a Tailwind theme token; the stylesheet uses Outfit on `body` and Cormorant in the named display classes, and the checks assert those actual source/compiled contracts without inventing a theme mapping.

The permanent Python regression tests are synthetic: they pass the checked-in font CSS plus `globals.css` through the validator, and deliberately comment out each variable. They prove the parser ignores comments and fails closed, but they are not evidence of a Next build or rendered browser/server output. Separately, the real red/green run below rebuilt the app after each source mutation in the offline namespace, then ran `verify-font-assets.py` against the resulting `.next` and production SSR/CSS.

| Real source mutation | Offline build | Actual verifier result |
| --- | ---: | --- |
| Remove `@import "./google-fonts.css";` | exit 0 | exit 1: source import absent |
| Render preload map under `false &&` | exit 0 | exit 1: production HTML had 0 font preloads, expected 3 |
| Comment out `--font-outfit` declaration | exit 0 | exit 1: linked compiled CSS had no effective Outfit declaration |
| Comment out `--font-cormorant` declaration | exit 0 | exit 1: linked compiled CSS had no effective Cormorant declaration |
| Restore baseline | exit 0 | `npm run verify:fonts` exit 0; HTTP 200, three preloads and compiled CSS contract pass |

Literal full output from these real builds and verifications is in ignored `storefront/.next/font-mutations-real.log`.
