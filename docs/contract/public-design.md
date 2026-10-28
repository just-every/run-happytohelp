# Retained public-site design

The approved
homepage (owner approval 2026-10-01, clarity pass 2026-10-02, hero redesign
2026-10-08, hero leading with help before they ask 2026-10-20) is the real public `/` experience, in
this order: the hero, whose headline “Knows what your customer needs before they do.” stands left-aligned beside one
hand-drawn picture of both moments on a pale aqua blob, joined by an aqua pen arrow: 1, a checkout page in its window
with the widget's offer card (signed with the speech-bubble mark) floating over its corner; 2, a conversation already
solved (a customer, Maya, cannot turn on the Spanish version of her store; the agent's fix, beside a code glyph, says
it is fixed; the reply to Maya carries Send inside it, the only step left), each numbered on a filled aqua disc; with
the subhead “Some customers who get stuck never write in. They just leave.”, the line
“100% free, open source alternative to Zendesk, Intercom, Help Scout and Freshdesk”, an aqua pen-stroke flourish under the calls to
action that draws itself in once, and under the picture the captions “Before they ask” (“When someone seems stuck,
the widget offers a hand.”) and “When they ask” (“Your Codex or Claude fixes the problem and writes the reply. You
press Send.”) on filled aqua number discs; “Not just better. Free.” (100% free and
open source, free as in code and free as in cost, MIT licensed, “No seats. No
plans. No fees.”, each promise after a line icon in a pale aqua circle, with the MIT license drawn as an ink card
over a wordless code editor, “free of charge” and the rights highlighted in aqua);
“The rest of your support desk” (chat widget, shared inbox, help center, suggested
replies, as frameless ink cards numbered on filled aqua discs); “Try it beside what you have” (install, bring the
help center from Zendesk, Intercom or Freshdesk, add the chat widget, on filled aqua discs, beside the finished
import in its window); “Ready when you are.”, a big closing headline with an aqua pen line drawn under it;
and the footer, signed with the header's lockup. Below the hero the drawings carry the hero's language: each
floats on a pale aqua blob, the mark's three aqua sparks spring from the corner of four of its cards, a window
frame stays only for the code editor, the checkout and the import, the text links carry the hero's aqua
underline, and a full-width aqua pen line with one loop divides Free from the desk and the desk
from Try it beside what you have. The page carries no price, hosting or provider line and no plug for any other service.
The drawings mirror the real interface and make no claim the product cannot
back; conversation, ticket-history and automation import, reporting and
compliance claims are deliberately absent. It is a warm off-white page in one geometric sans-serif
(Outfit, self-hosted from `public/fonts/outfit/`, so the page makes no
third-party request, over a metric-matched local fallback, so no text moves
when it loads) with near-black ink and black pill buttons; color
appears only inside the drawings, which are labeled HTML/SVG rather than raster images,
and in aqua accents outside them (the hero's and the desk's number discs, the promises' circles, link underlines, the
hero flourish, the dividers, the closing line) and in the sparks of the speech-bubble mark beside the header and
footer wordmark. The wordmark is not set in Outfit: it is drawn by hand as round-capped SVG strokes following
Nunito's letter shapes (SIL OFL), with no font data embedded, and the link it sits in is named HappyToHelp by
visually hidden text. The page's text
and real links, derived from `package.json` `repository.url`, are ordinary DOM
content; the hero flourish draws in once as the page appears, and each moment below the hero (a drawing, the
promises, the steps, a desk card, a divider, the closing line) plays once, in under 1.8s, as it scrolls into view
(an IntersectionObserver), moving only opacity, transforms, clipping and strokes, so nothing shifts; reduced-motion
preferences remove all animation, transitions and smooth scrolling without
changing layout, leaving every drawing in its final state and every stroke fully drawn. `/docs` renders, at build
time, the Markdown files listed in `docs/site.json`, in the homepage's paper,
ink and Outfit, with section navigation, page contents and GitHub links for
everything unpublished; an unknown page gets the branded 404. Every build
renders the current files, and an unlisted Markdown file fails verification. Dynamic published
help centers retain project scope, canonical links, search and draft/deleted denial. The customer widget
remains available through owner-configured installation; broader marketing
routes, pricing, legal, referrer, waitlist and public auto-widget behavior
are outside this edition.

The detailed pre-conversion homepage and documentation acceptance specification is retained in [the acceptance source](../verify.md).
