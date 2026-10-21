# Public assets and their provenance

Everything in this repository, including the artwork described below, is
released under the MIT licence in the root [`LICENSE`](../LICENSE). Bundled
third-party components keep their own licences, listed at the end of this page.

## First-party artwork and branding (MIT)

The twenty female-1, female-2, male-1 and male-2 widget avatar variants
retain their original PNG image data and MIT coverage. Publication removes
only ancillary text metadata containing an authoring-machine contact address;
image dimensions, palette, transparency and compressed pixel bytes are unchanged.

All of the following are owner-generated or owner-supplied and are covered by
the root MIT licence like the rest of the source:

- **Homepage drawings** (owner approval 2026-10-01, handoff-first order
  2026-10-01, hero redesign 2026-10-08): the hero handoff (a solved conversation:
  the customer's message, the agent's fix and the reply with Send, on a pale aqua
  blob) and the hero flourish, the MIT licence card, the widget offer, the four
  product drawings and the finished article import are first-party React components, HTML and
  inline SVG in `src/ui/homepage/drawings/` styled by
  `src/ui/homepage/drawings.css`. They were drawn as real DOM text from the
  owner-approved design direction and from this repository's own dashboard and
  widget components (labels, structure and states), not from screenshots; no
  screenshot is distributed. No raster image, third-party illustration or logo
  is used; Codex and Claude are named in text only.
- **HappyToHelp mark** (owner choice 2026-10-08): a speech bubble with its tail
  at the lower left, a closed-eye smile and three cyan sparks, drawn by hand as
  SVG paths from the owner-chosen 12ui logo direction. Its geometry lives once, in
  `src/ui/homepage/brand-mark.ts`: the public header and footer draw it inline
  beside the wordmark, and `public/homepage/media/brands/happytohelp-mark.svg` and
  `happytohelp-favicon.svg` (the bubble and face alone, without the sparks so the
  bubble fills the tab, with heavier strokes for 16 and 32px tabs) are generated
  from it. `happytohelp-favicon.png` (512x512, transparent,
  the favicon fallback) and `happytohelp-apple-touch-icon.png` (180x180 on the
  page's paper) are rendered from those SVG files in Chromium. Every application
  page (`src/routes/__root.tsx`) uses them as its tab icon, and the dashboard draws
  its unread count on the SVG. The identity pages, the platform-admin sidebar, the
  dashboard's load-error screen and the no-project Help Center page draw the same
  mark inline (the Help Center page through `markSvg()`). The earlier smiley-circle
  mark, `public/img/icon.svg` (SHA-256
  `93f377cffc031d58b27e9911737717f1d1b76b8456dd9cc06510c4a660ee9e4e`, 1,200 bytes),
  and the widget's unused copies of it and of the old horizontal logo were removed.
  Each file's SHA-256, byte count and origin are recorded in
  [`src/ui/homepage/asset-provenance.json`](../src/ui/homepage/asset-provenance.json).
- **HappyToHelp wordmark** (owner choice 2026-10-09): the word "HappyToHelp"
  beside the mark, drawn by hand as SVG strokes following the letter shapes of
  Nunito (SIL Open Font License 1.1): monoline centre-line strokes with round caps
  and joins, at the mark's pen weight, letters set a little tighter
  than Nunito's own spacing. No font data is embedded or served; the strokes are
  the whole of it. Its geometry lives once, in `src/ui/homepage/brand-word.ts`,
  and the public header and footer draw it inline (`BrandWord.tsx`) as a
  decorative SVG, the link named by visually hidden text; the no-project Help
  Center page draws the same element from `wordSvg()`.

The homepage is an ordinary React route in `src/routes/index.tsx` built from the
components in `src/ui/homepage`. Its text and links are real DOM content, and
each drawing carries one accessible label; the only motion is a one-time
draw-in of the sketch marks, which reduced-motion preferences remove.
Its source and documentation links derive from the `repository` field in
`package.json`.

## First-party styles and generated files (MIT)

- **Dashboard styles** under `src/ui/dashboard/styles` (the entry
  `dashboard.scss` and the `foundation/` partials) and the component styles
  beside them are first-party, built on Bootstrap 5.3 (MIT). Their only
  third-party inputs are Bootstrap, the `feather-icons` package (MIT), the
  highlight.js `vs2015` code style (BSD-3-Clause) and the self-hosted Outfit
  file their icon metrics borrow (see below). Their text is the system UI face,
  so they host no text font. No commercial theme, font or image is used; the removed files
  and their hashes are recorded in
  [`src/ui/dashboard/asset-provenance.json`](../src/ui/dashboard/asset-provenance.json).
- **Help Center stylesheet**: `public/site-assets/help_center/css/app.css` is a
  first-party replacement for the original service's public-site theme. The
  hashes of the retired theme and pattern files, and why they were removed, are
  recorded in [`src/modules/public-site/asset-provenance.json`](../src/modules/public-site/asset-provenance.json).
- **Generated at build time** and not committed: `public/widget.js` (the
  customer widget) and `public/downloads/happytohelp-local-agent.tar.gz` (the
  local agent, packaged from an explicit allowlist with no credentials or
  runtime state).

## Third-party components

| Component | Where | Licence and notice |
| --- | --- | --- |
| Outfit typeface (Copyright 2021 The Outfit Project Authors, <https://github.com/Outfitio/Outfit-Fonts>) | `public/fonts/outfit/`: the variable-weight latin and latin-ext WOFF2 files, copied unchanged from the npm package `@fontsource-variable/outfit` 5.3.0 (built from <https://github.com/google/fonts>) and declared in `src/ui/homepage/outfit.css`. The homepage serves them itself and makes no request to a font host. Chosen over Plus Jakarta Sans, Manrope, Urbanist, Figtree, Lexend, Albert Sans and Sora as the closest match to the approved headline by rendering them side by side | SIL Open Font License 1.1, `public/fonts/outfit/LICENSE.txt` |
| Feather icons (`feather-icons` 4.29.2, Cole Bemis) | npm package; its SVGs are inlined as CSS masks in the built dashboard stylesheet (`src/ui/dashboard/styles/foundation/_icons.scss`) | MIT, [`docs/licenses/FEATHER-ICONS.md`](licenses/FEATHER-ICONS.md) |
| Font Awesome Free | npm packages used by the widget and dashboard | MIT code and CC BY 4.0 icons, [`docs/licenses/FONT-AWESOME-FREE.md`](licenses/FONT-AWESOME-FREE.md) |
| Lobe Icons (Claude and Codex logo paths) | `src/ui/dashboard/components/LocalAgentGlyph.jsx` | MIT, [`docs/licenses/LOBE-ICONS.md`](licenses/LOBE-ICONS.md) |
| favcount 1.5.0 (Copyright 2013 Chris Hunt) | `src/ui/dashboard/favcount.jsx` | MIT, notice inline at the top of that file |
| Lucide reply icons | `src/ui/dashboard/components/reply-icons/` | ISC, `LUCIDE-LICENSE.txt` in that directory |
| Ensemble model runtime | `src/modules/ai-support/vendor/ensemble/` | MIT, `LICENSE`, `SOURCE.json` and `SOURCE.patch` in that directory |
| Run Edit Run Base | `src/base`, `src/vendor/base`, `scripts/edition-authoring`; CLI dependency `@runeditrun/rer` | MIT, [`docs/licenses/base-MIT.txt`](licenses/base-MIT.txt) |
| npm dependencies | `package.json`, `pnpm-lock.yaml` | Each package's own licence |

No Font Awesome Pro package or asset is included.

## External requests

The homepage makes no third-party request: its Outfit font files are served
from `public/fonts/outfit/`. The customer widget sets its text in the visitor's
system UI face, so it embeds no font and makes no font request on the page that embeds it. The Help
Center stylesheet makes no external font or image request. The homepage does not
load the customer widget, analytics or any tracking script, and no public page
embeds an operator token, widget secret or tracking ID. The customer widget is a
separate asset (`/widget.js`) that each owner installs on their own website.
