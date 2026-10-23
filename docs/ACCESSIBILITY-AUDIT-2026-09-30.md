# Dashboard and widget accessibility audit

This is a bounded local Chromium audit targeting WCAG 2.2 AA, not complete WCAG certification or assistive-technology acceptance. It supersedes the earlier closeout's unsupported claims about populated article Delete contrast, settled note-dialog containment, and translucent branding focus contrast. The correction starts from composed source `c7f0d1b8ce447e59804d736ce364e9812dcf2715`.

## Current final disposition — FAIL / confirmed owner HOLD

The final independent gate targets source
`f2054c3b7cd19fcddd9962e418f680f92c89109b`. The recorded owner direction is:
“Hold the checker; record the audit limitation (default)”. Two correction rounds
are exhausted; no third checker correction is authorized.

The untouched final run passed 21 states and 21 checks with zero Axe violations,
69 measured review nodes and 18 LIMITED nodes. All covered/unsupported pixels
remain LIMITED. The independent and root adversarial oracle each retained four
false accepts among 23 cases: pseudo/ancestor opacity text reported 8.475:1 or
12.63:1 has actual screenshot contrast at most 2.27:1. The real-Axe minimal
reproducer fails its unsuppressed regression assertion. These are checker
correctness failures; isolated oracle fixtures do not establish a product defect.

The root's untouched full audit also failed the widget email label at 4.36:1.
Natural animation frames and settled actual glyph/background screenshots support
a timing/background error: settled glyphs measure 6.324:1. The exact root frame
is inferred because its capture omits opacity. Retain the failure; the independent
full-run pass does not repair timing reliability. No remaining steady product
AA defect was established in the exercised corrected states, and no blanket
WCAG conformance follows.

Six product correction checks, four occlusion regressions, 26 independent keyboard
checks and five independent runtime checks passed. Native demo and ten parity
rows carry from exact unchanged verified source/emitted bundles rather than a
fresh demo execution. Exact historical reports and failed attempts remain in
maintainer custody outside the public product tree. They do not qualify a later
source revision without its own checks.

## Corrections and direct evidence

- The populated article editor's red Delete text was `#e63757` on white (4.15:1). Its existing destructive text style now uses `#c62949`; desktop and 320-pixel measurements must pass the unchanged 4.5:1 threshold. The check creates an article through the real local API, opens its editor, and activates and cancels the real deletion confirmation with Enter at both widths.
- The settled Add Note dialog previously let forward Tab escape through BODY and could strand reverse navigation on the dialog container. A dialog-level boundary now resolves current native tab stops on each Tab, wraps in both directions, and focuses the dialog when all controls are disabled. The close icon follows the same busy state as Note, Close and Add. The audit waits beyond the entrance transition, verifies container entry in both directions and three complete forward and reverse four-control loops (24 presses), Escape and Reply tools restoration. It also delays then forwards an unchanged real note request to prove all four controls are disabled while busy, Tab/Shift+Tab remain contained, Escape does not cancel the in-flight save, and the resulting note persists.
- Additional branding previously used `rgba(113,62,224,.4)` on white: the composited ratio is about 1.90:1, not the opaque RGB value 6.06:1. Native summaries now receive the existing opaque focus ring and halo. Eight pixels of spacing prevent the ring overlapping the adjacent brand image. The corrected oracle also exposed a fading, initially transparent halo over the mobile navigation surface; focus styles now apply immediately, and that control has a separate rendered-pixel check. The widget Send button also inherited a white outside ring that blended into its light surrounding surface; removing that override restores the existing blue ring, verified against the outside surface rather than its blue button fill. Both computed alpha compositing and independent screenshot pixels are checked against 3:1 at desktop and 320 pixels; Enter and Space toggle the disclosure and Tab reaches Logo URL.

The one-off component and contrast-oracle correction fixtures were removed from the permanent suite in the October test-budget prune. Public-door focus, busy-dialog and rendered-contrast coverage remains in `tests/accessibility-browser.mjs`, using `tests/helpers/accessibility-correction-flow.mjs` against the real Worker/D1/R2 runtime.

## Rendered audit scope

`pnpm run test:accessibility-browser` runs Axe 4.13.0 with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa`. All original 19 states are retained, with two additional populated editor scans:

| Surface | Rendered states |
| --- | --- |
| Dashboard, original 13 | Setup; login; populated inbox; open workspace switcher; open composer tools; note dialog; account menu; project settings General; Appearance; knowledge datasets; knowledge articles list; knowledge categories; 320-pixel mobile inbox. |
| Widget, original 6 | Consent-granted closed widget; open composer; validation errors; image attachment composer; image preview dialog; 320-pixel mobile widget. |
| Added dashboard 2 | Populated article editor at 1440 and 320 CSS pixels. |

The worker and widget host use synthetic local tenant/customer records. The article-list scan retains its empty state; populated article coverage is explicitly the added editor. The widget mobile state includes both an image and a non-image attachment. Image preview supports a keyboard-contained dialog with Escape and trigger restoration. Non-image media uses an actual blob link: Enter opens its content in a separate tab. Its focusable target now has 24-pixel minimum height and spacing so the outside focus ring does not overlap adjacent file-size text; the focused mobile state remains in the contrast scan. Although the preview component has an iframe branch, supported media controls never open that branch; no iframe-preview state or coverage is claimed.

The skip link moves focus to main content. Workspace/account menus retain Escape restoration. The mobile inbox list is inert and hidden from assistive technology while its conversation covers it. Reflow checks use desktop, 320 CSS pixels and a reduced CSS viewport equivalent to 200% zoom; this is not operating-system scaling. Layout receipts include visible control sizes, clipping, names and center reachability.

## Historical first correction evidence and disposition

The historical first correction run returned **zero Axe violations across 21 scans** in Chromium 153.0.8010.12. Its only incomplete rule was color contrast: the original successful correction run reported 86 nodes, of which 74 were measured against rendered background pixels (minimum 4.61:1) and 12 remained explicitly limited below. Axe may additionally report menu-covered labels; the exact final per-node counts and hit-test dispositions are retained in the machine-readable summary. All direct text/icon measurements passed (40 including the unoccluded Settings navigation label). Article Delete measured **5.51:1** at both widths; branding focus measured **5.98:1** in both compositing and pixels. The Send ring measured **5.55:1** against its actual surrounding surface. Seven general keyboard passes made 122 Tab presses and recorded 113 named, visible, reachable stops (minimum computed ring contrast 4.23:1), in addition to the dedicated note/disclosure/media checks.

| Limited contrast target | Count | Disposition |
| --- | ---: | --- |
| Inbox suggestion under the open note dialog | 1 | Covered by the modal; its unobscured inbox rendering measured 6.06:1. No fabricated modal-background sample. |
| Settings navigation label under the account menu, when reported by Axe | Variable | Four corners and center of every text fragment must be hit-tested inside the covering menu before this is marked limited. Menu pixels are never counted as a passing label measurement; the unoccluded label is measured separately. |
| Native timezone select text | 1 | No exposed text fragment for the pixel sampler. Direct resolved control text measured 17.27:1; embedded chevron separately measured 3.82:1. |
| Dashboard account initials | 2 | One-character text not classified by Axe; the same initials/fill measured 6.41:1 directly. |
| Widget header/launcher responder initials | 8 | Shadow/pseudo-element composition not resolved by Axe; the repeated visible initials/fill measured 8.73:1 directly. |

Seven layout measurements found no horizontal overflow, clipped controls, unnamed controls or unreachable centers. The populated article's Published switch is 36×20 pixels at both widths; its separate target-spacing receipt checks that its centered 24-pixel circle does not intersect another target or another undersized target's circle. It is not falsely reported as a 24×24 target. The other five layout measurements have no targets below 24×24.

Build, typecheck, the six independent correction checks and `git diff --check` passed. The protected-input receipt verifies 214 original non-audit tests, fixtures and migrations against the composed base byte for byte. Commands used Node 26.8.1 and pnpm 10.12.4:

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run typecheck
H2H_EVIDENCE_DIR=.local-evidence/accessibility node tests/accessibility-browser.mjs
```

The commands write machine-readable results, screenshots and measurements into
the selected evidence directory. Keep diagnostic failed attempts separate from
final results, and record the source revision and emitted artifact hashes.

Axe incomplete color-contrast nodes are not counted as Axe passes. The existing pixel sampler measures the background behind text where it can resolve visible text fragments; `incompleteContrast` retains each measured or limited disposition. Obscured background content under a dialog, native select text and avatar initials require separate disposition rather than a fabricated sample. Direct style measurements resolve foreground alpha; keyboard focus measurements now composite outline and halo alpha, with rendered-pixel checks for the corrected branding control. Solid ring/halo checks do not establish arbitrary custom-theme, image-backed or ancestor-opacity combinations.

## Limits

This audit covers Chromium, the listed native states and the configured single human responder. That widget configuration has a static named responder, not an operable picker, so multi-responder picker acceptance remains unverified. VoiceOver, NVDA, JAWS, other browser/assistive-technology combinations and independent human review remain required outside this local evidence. No live email/model/provider calls, deployment, production import or public-release acceptance are claimed. The provider and feature gaps in `UI-PARITY.md` remain explicit; its ten rows each record reason, user impact and a supported alternative or none, including the existing native demo inbox.

The corrections retain the accepted presentation. The applicable 12ui guidance was read and its existing-style integration path used; no remote or charged design operation was run. Original non-audit tests, fixtures and migrations remain byte-identical. Refresh the source lock after intentional tracked changes; integrity checks do not substitute for the accessibility evidence above.
