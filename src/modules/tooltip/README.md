# Tooltip

The tooltip of an icon-only control: two to four words naming its action, which are also its accessible name.

- `tooltip(label, placement?)` returns the control's props: `aria-label` and the `data-tooltip` marker (with
  `data-tooltip-placement` of `top` (default), `bottom`, `left` or `right`; the layer flips to the side with room).
- A control that acts on one row of a list (a chip's ×, a row's ⋮ or Close) keeps the short name and names its row as
  its accessible description: `tooltip('Remove category', { describedBy: id })` (with `placement` too, if any) adds
  `aria-describedby` to the id of the element that shows the row's name, or of a `hidden` element holding it. A screen
  reader then hears "Remove category, button, Billing"; the tooltip and the name stay the short words. Never fold the
  row into the label.
- Every element that acts on a click is a control: an icon-only one is a `<button>` (or link) with `tooltip()`, never a
  `div` or `span` with `onClick`, which has no name, no tooltip and no keyboard access.
- `<TooltipLayer />` (`TooltipLayer.tsx`, with `tooltip.css`) shows them for the whole document. Mount it once.
- `installTooltips(root, container?)` is the same layer without React, for a document or a shadow root (an embedded
  widget's); it returns its removal. Each layer answers only for the controls in its own root.
- Behaviour: about 300 ms after a mouse rests on the control (at once for the next one), at once on keyboard focus, on a
  touch long press whose tap is then not acted on; hides on leave, a press, Escape, scroll and resize. It sits in the
  browser's top layer, clear of the pointer and the viewport's edges, and is hidden from assistive technology.
- Look: `--tooltip-bg`, `--tooltip-fg`, `--tooltip-font-size`, `--tooltip-padding`, `--tooltip-radius` and
  `--tooltip-shadow`, read on the control, so each surface can set its own. Never give the control a `title` as well.

It imports nothing from HappyToHelp. HappyToHelp sets its colours in `src/ui/homepage/brand-tokens.css`.
