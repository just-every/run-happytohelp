import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import DelegationAttachments from './DelegationAttachments';

function ResultOption({ option, kind, isDraftDisabled, isActionDisabled, onAction, onUse, verified }) {
    const [ pending, setPending ] = useState(false);
    const inFlight = useRef(false);
    const isReply = kind === 'reply';
    const used = isReply ? Boolean(option.message_id) || option.status === 'sent'
        : Boolean(option.child_delegation_id) || option.status === 'started';
    const uncertain = option.status === 'uncertain' || option.status === 'sending';
    const needsReview = option.status === 'needs_review';
    const blocked = uncertain || needsReview || isActionDisabled;

    const action = async () => {
        if (inFlight.current || used || blocked) return;
        inFlight.current = true;
        setPending(true);
        try {
            await onAction(option.id);
        } catch (error) {
            // The panel keeps request errors visible alongside the result.
        } finally {
            inFlight.current = false;
            setPending(false);
        }
    };

    return <article className={ 'delegation-result-option' + (used ? ' is-used' : '') }>
        <i className={ isReply ? 'fe fe-message-circle' : 'fe fe-zap' } aria-hidden="true" />
        <div className="delegation-result-option__content">
            <h4>{ option.title }</h4>
            <p>{ isReply ? option.body : option.instructions }</p>
            <DelegationAttachments attachments={ option.attachments } />
            { !isReply && <small>{ option.mode === 'resolve_reply' ? 'Resolve & reply' : option.mode === 'resolve' ? 'Resolve' : 'Investigate' }</small> }
            { needsReview && <small role="status">{ option.review_message || 'Review the conversation before replying. You can edit this draft in the composer.' }</small> }
            { isReply && !verified && <small>Review this unverified draft in the composer before sending.</small> }
        </div>
        <div className="delegation-result-option__actions">
            { isReply ? <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={ () => onUse(option.body, option.attachments, option.id) }
                disabled={ used || uncertain || isDraftDisabled }
                aria-label={ 'Use ' + option.title }
            >
                <i className={ used ? 'fe fe-check' : 'fe fe-edit-2' } aria-hidden="true" />
                { used ? 'Sent' : uncertain ? 'Checking delivery' : 'Use' }
            </button> : <button
                type="button"
                className="btn btn-sm btn-white"
                onClick={ action }
                disabled={ pending || used || blocked }
                aria-label={ 'Run ' + option.title }
            >
                <i className={ used ? 'fe fe-check' : 'fe fe-play' } aria-hidden="true" />
                { pending ? 'Starting…' : used ? 'Queued' : uncertain ? 'Checking delivery' : needsReview ? 'Needs review' : 'Run' }
            </button> }
        </div>
    </article>;
}

export default function DelegationResultOptions({ job, isDraftDisabled, onInsertDraft, onRunFollowUp }) {
    const replies = Array.isArray(job.result?.replies) ? job.result.replies : [];
    const followUps = Array.isArray(job.result?.follow_up_actions) ? job.result.follow_up_actions : [];

    return <div className="delegation-result-options">
        { replies.length > 0 && <section aria-label="Suggested replies">
            <h3><i className="fe fe-message-circle" aria-hidden="true" /> Suggested replies</h3>
            { replies.map(reply => <ResultOption key={ reply.id } option={ reply } kind="reply" isDraftDisabled={ isDraftDisabled } verified={ job.result.verified === true }
                onUse={ (body, attachments, proposalId) => onInsertDraft(body, attachments, { jobId: job.id, proposalId }) } />) }
        </section> }
        { followUps.length > 0 && <section aria-label="Follow-up actions">
            <h3><i className="fe fe-zap" aria-hidden="true" /> Follow-up actions</h3>
            <p>Approving a follow-up grants a new 15-minute task. Customer reply permission stays separate.</p>
            { followUps.map(action => <ResultOption key={ action.id } option={ action } kind="follow-up" isActionDisabled={Boolean(job.authority?.expired)} onAction={ id => onRunFollowUp(job.id, id) } />) }
        </section> }
    </div>;
}

ResultOption.propTypes = {
    isDraftDisabled: PropTypes.bool,
    isActionDisabled: PropTypes.bool,
    option: PropTypes.object.isRequired,
    kind: PropTypes.string.isRequired,
    onAction: PropTypes.func,
    onUse: PropTypes.func,
    verified: PropTypes.bool,
};

DelegationResultOptions.propTypes = {
    isDraftDisabled: PropTypes.bool,
    job: PropTypes.object.isRequired,
    onInsertDraft: PropTypes.func.isRequired,
    onRunFollowUp: PropTypes.func.isRequired,
};
