import React from 'react';
import Moment from '../../Moment';
import { Section } from '../forms';
import { checkLabels, countsParts, sourceNames, stateLabels, timeFormat } from './cutover-presentation';

const When = ({ at }) => <Moment date={at} format={timeFormat(at)}/>;

/** The counts as one quiet line: the pieces joined by a middle dot, a time piece rendered inline. */
function CountsLine({ source }) {
    const pieces = countsParts(source).filter(Boolean);
    return <p className="settings-note cutover-counts">{pieces.map((piece, index) => <React.Fragment key={index}>
        {index > 0 && ' · '}
        {typeof piece === 'string' ? piece : <>{piece.text} <When at={piece.at}/>{piece.after && ` ${piece.after}`}</>}
    </React.Fragment>)}</p>;
}

function Step({ step }) {
    return <li className="cutover-step">
        <p className="cutover-step__change">{step.change}</p>
        <p className="cutover-step__meta">
            {stateLabels[step.state]}
            <span aria-hidden="true"> · </span><span className={`cutover-check cutover-check--${step.check.result}`}>{checkLabels[step.check.result]}</span>
            <span aria-hidden="true"> · </span><When at={step.recordedAt}/>
            <span aria-hidden="true"> · </span>{step.recordedBy.name}
        </p>
        {step.check.detail && <p className="cutover-step__text">{step.check.detail}</p>}
        <p className="cutover-step__text"><span className="cutover-step__label">Undo</span> {step.undo}</p>
    </li>;
}

/** One move-in source: its name and where it stands, its live counts, then every step recorded for it, newest first. */
export default function CutoverSource({ source }) {
    return <Section card title={<>{sourceNames[source.id]}<span className={`cutover-state cutover-state--${source.state}`}>{stateLabels[source.state]}</span></>}>
        <CountsLine source={source}/>
        {source.steps.length > 0 && <ol className="cutover-steps" aria-label={`${sourceNames[source.id]} steps`}>{source.steps.map(step => <Step key={step.id} step={step}/>)}</ol>}
    </Section>;
}
