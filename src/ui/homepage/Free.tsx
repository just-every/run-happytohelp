import { HydrationUnit } from '../../vendor/base/hydration/unit';
import { Icon } from './drawings/Icons';
import { LicenceDrawing } from './drawings/LicenceDrawing';
import { sourceUrl } from './repository';
import { useReveal } from './reveal/useReveal';

const proof = ['No seats.', 'No plans.', 'No fees.'];
// One line icon for each promise, in an aqua circle: people for seats, a plan sheet for plans, a struck-through tag for fees.
const proofIcons = [<Icon name="people" />, <Icon name="plans" />, <Icon name="fees" />];

export function Free() {
  const reveal = useReveal<HTMLUListElement>();
  return <HydrationUnit><section className="section free" id="free" aria-labelledby="free-title">
    <div className="split">
      <div className="split-copy">
        <h2 id="free-title">Yours to run and change.</h2>
        <p>HappyToHelp is open source and MIT licensed, so it’s yours to use, change and run however you like.</p>
        <div className="actions"><a className="pill pill--ink pill--large" href={sourceUrl}>Get the code</a></div>
        <p className="free-note">You can also have all the source for free.</p>
      </div>
      <LicenceDrawing />
    </div>
    <ul className="proof" ref={reveal}>{proof.map((item, index) => <li key={item}><span className="proof-icon">{proofIcons[index]}</span>{item}</li>)}</ul>
  </section></HydrationUnit>;
}
