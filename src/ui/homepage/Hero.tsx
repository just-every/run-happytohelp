import { HydrationUnit } from '../../vendor/base/hydration/unit';
import { Flourish } from './drawings/Flourish';
import { HeroStory } from './drawings/HeroStory';
import { docsUrl, sourceUrl } from './repository';

// The two moments the drawing tells, numbered as in the drawing.
const moments = [
  { title: 'Before they ask', text: 'When someone seems stuck, the widget offers a hand.' },
  { title: 'When they ask', text: 'Your Codex or Claude fixes the problem and writes the reply. You press Send.' },
];

export function Hero() {
  return <HydrationUnit><section className="hero" id="top" aria-labelledby="hero-title">
    <div className="hero-copy">
      <h1 id="hero-title">Knows what your customer needs before they do.</h1>
      <p className="hero-sub">Some customers who get stuck never write in. They just leave.</p>
      <div className="actions"><a className="pill pill--ink pill--large" href={sourceUrl}>Get the code</a><a className="text-link" href={docsUrl}>Read the docs</a></div>
      <p className="hero-free">Open source alternative to <span className="hero-free-names"><strong>Zendesk</strong>, <strong>Intercom</strong>, <strong>Help&nbsp;Scout</strong> and <strong>Freshdesk</strong></span></p>
      <Flourish intro />
    </div>
    <div className="hero-stage">
      <HeroStory />
      <ol className="hero-moments">{moments.map(moment => <li key={moment.title}><b>{moment.title}</b><p>{moment.text}</p></li>)}</ol>
    </div>
  </section></HydrationUnit>;
}
