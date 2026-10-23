# Tooltip

The tooltip of an icon-only control: two to four words naming its action, which are also its accessible name.

- `tooltip(label, placement?)` returns the control's props: `aria-label` and the `data-tooltip` marker (with
  `data-tooltip-placement` of `top` (default), `bottom`, `left` or `right`; the layer flips to the side with room).
- `<TooltipLayer />` (`TooltipLayer.tsx`, with `tooltip.css`) shows them for the whole document. Mount it once.
- `installTooltips(root, container?)` is the same layer without React, for a document or a shadow root (an embedded
  widget's); it returns its removal. Each layer answers only for the controls in its own root.
- Behaviour: about 300 ms after a mouse rests on the control (at once for the next one), at once on keyboard focus, on a
  touch long press whose tap is then not acted on; hides on leave, a press, Escape, scroll and resize. It sits in the
  browser's top layer, clear of the pointer and the viewport's edges, and is hidden from assistive technology.
- Look: `--tooltip-bg`, `--tooltip-fg`, `--tooltip-font-size`, `--tooltip-padding`, `--tooltip-radius` and
  `--tooltip-shadow`, read on the control, so each surface can set its own. Never give the control a `title` as well.

It imports nothing from HappyToHelp. HappyToHelp sets its colours in `src/ui/homepage/brand-tokens.css`.
