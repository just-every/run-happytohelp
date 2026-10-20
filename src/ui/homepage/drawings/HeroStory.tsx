import { BrandMark } from '../BrandMark';
import { Icon } from './Icons';
import { Drawing, SketchWindow } from './Sketch';

// The hero tells both moments in one drawing on one pale aqua blob. 1, before they ask: a checkout page in its window,
// the widget's small offer card, signed with the speech-bubble mark, floating over its lower right corner. 2, when they
// ask: Maya's conversation, already solved: her question, the agent's fix beside a code glyph, and the reply to her with
// Send still to press. A loose aqua pen arrow carries the eye from the first to the second; it draws in once with the
// flourish (drawings.css). The figure is a size container and every length inside is in em, so the picture scales as one.
const label = 'Drawing of two moments. One, before they ask: on a checkout page the chat widget asks: Looks like you might be stuck. Would you like a hand with checkout? with Yes please and No thanks. Two, when they ask: Maya can’t turn on the Spanish version of her store. The agent fixes it: Spanish is live on her store. The reply to Maya is ready, and the next step is to press Send.';

export function HeroStory() {
  return <Drawing className="story-art" label={label}>
    <svg className="story-blob story-blob--wide" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M3 44C5 28 14 16 28 12 40 9 52 12 62 8 72 4 84 1 92 6 99 11 100 26 99 42 98 58 100 76 94 88 87 99 70 98 56 96 44 95 30 99 18 96 6 93 1 80 2 66 2 58 2 51 3 44Z" />
    </svg>
    <svg className="story-blob story-blob--tall" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M6 12C14 3 34 1 52 2 70 3 88 4 95 14 100 24 98 40 98 54 98 70 100 84 93 93 85 100 64 98 48 98 30 98 12 100 5 90 0 80 2 64 2 50 2 34 0 22 6 12Z" />
    </svg>
    <div className="story">
      <div className="story-moment story-before">
        <SketchWindow className="story-checkout">
          <div className="story-page">
            <span className="story-page-title"><Icon name="cart" />Checkout</span>
            <span className="sk-field" /><span className="sk-field" />
            <span className="sk-pay">Pay now</span>
          </div>
        </SketchWindow>
        <div className="d-card story-offer">
          <span className="story-offer-mark"><BrandMark /></span>
          <p>Looks like you might be stuck. Would you like a hand with checkout?</p>
          <span className="d-btn d-btn--ink">Yes please</span>
          <span className="d-btn">No thanks</span>
        </div>
        <span className="story-number">1</span>
      </div>
      <svg className="story-arrow" viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path data-intro="" pathLength={1} d="M3 27C14 15 30 11 46 15 51 16 55 18 59 21" />
        <path data-intro="" pathLength={1} d="M50 12 59.5 21 47.5 25" />
      </svg>
      <div className="story-moment story-when">
        <SketchWindow className="story-thread">
          <b className="story-who"><Icon name="person" />Maya</b>
          <p className="story-bubble">I can’t turn on the Spanish version of my store.</p>
          <div className="story-row">
            <span className="story-glyph"><Icon name="code" /></span>
            <p className="story-bubble story-bubble--fix">Fixed. Spanish is live on Maya’s store.</p>
          </div>
          <div className="story-bubble story-composer">
            <p>All done, Maya. Refresh and it’s there.</p>
            <span className="d-btn d-btn--ink story-send">Send</span>
          </div>
        </SketchWindow>
        <span className="story-number">2</span>
      </div>
    </div>
  </Drawing>;
}
