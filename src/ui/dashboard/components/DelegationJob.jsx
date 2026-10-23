import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import TextareaAutosize from 'react-textarea-autosize';
import DelegationResultOptions from './DelegationResultOptions';
import DelegationAttachments from './DelegationAttachments';

const modeNames = {
    investigate: 'Investigate',
    resolve: 'Resolve',
    resolve_reply: 'Resolve & reply',
};

const statusNames = {
    queued: 'Queued for this device',
    running: 'Working locally',
    needs_input: 'Needs your input',
    completed: 'Completed',
    failed: 'Could not complete',
    cancelled: 'Cancelled',
    revoked: 'Authority revoked · local outcome unconfirmed',
};

// A completed report whose follow-up effects stopped says why, so an undelivered reply is never mistaken for a sent one.
const completionNotices = {
    authorization_lost: 'Authority was withdrawn before this report’s note or reply was recorded.',
    authority_expired: 'Task authority expired. No further reply or follow-up may use this grant; inspect the local outcome before authorizing new work.',
    review: 'The reply was not delivered. Review the conversation before replying yourself.',
};

const isActive = job => [ 'queued', 'running', 'needs_input' ].includes(job.status);
const formatEvidence = evidence => Array.isArray(evidence) ? evidence.join(', ') : evidence;

export default function DelegationJob({ job, isDraftDisabled, onCancel, onInsertDraft, onSendInput, onRunFollowUp }) {
    const [ input, setInput ] = useState('');
    const [ hasReviewedFreshness, setHasReviewedFreshness ] = useState(false);
    const [ isCancelling, setIsCancelling ] = useState(false);
    const [ isSendingInput, setIsSendingInput ] = useState(false);
    const result = job.result && typeof job.result === 'object' ? job.result : null;
    const progress = Array.isArray(job.progress) ? job.progress : [];
    const inputMessages = Array.isArray(job.input_messages) ? job.input_messages : [];
    const expired = Boolean(job.authority?.expired);
    const active = isActive(job) && !expired;
    const completed = job.status === 'completed';
    const replyWasSent = job.mode === 'resolve_reply' && job.delivery_state === 'delivered';
    const canInsertDraft = Boolean(result?.reply_draft) && job.mode !== 'resolve_reply' && !expired;
    const freshnessReview = job.freshness_review?.required ? job.freshness_review : null;
    const freshnessReviewId = freshnessReview?.latest_last_message_id || null;
    const statusLabel = expired ? 'Task authority expired · local outcome unconfirmed' : job.status === 'revoked' && job.delivery_state === 'membership_lost'
        ? 'Workspace access ended · local outcome unconfirmed'
        : statusNames[job.status] || job.status;
    const latestProgress = progress[progress.length - 1] || null;
    const authority = <small className="delegation-job__authority">
        Authorized by operator { job.operator_id }{ ' · ' }
        <time dateTime={ job.created_at }>{ new Date(job.created_at).toLocaleString() }</time>
        { job.authority && <span>{' · '}Authority {expired ? 'expired' : 'expires'} <time dateTime={new Date(job.authority.expires_at).toISOString()}>{new Date(job.authority.expires_at).toLocaleString()}</time></span> }
        { job.parent_delegation_id && <span>{ ' · ' }Approved follow-up of{ ' ' }
            <a href={ '#delegation-job-' + job.parent_delegation_id }>investigation { job.parent_delegation_id }</a>
        </span> }
    </small>;

    useEffect(() => {
        // A confirmation applies only to the exact conversation position that
        // the runner requested. A newer message requires an explicit review.
        setHasReviewedFreshness(false);
    }, [ freshnessReview?.required, freshnessReviewId ]);

    const cancel = async () => {
        setIsCancelling(true);
        try {
            await onCancel(job.id);
        } catch (error) {
            // The panel renders the API error in a stable location.
        } finally {
            setIsCancelling(false);
        }
    };

    const submitInput = async event => {
        event.preventDefault();
        const message = input.trim();
        if (!message || isSendingInput || (freshnessReview && !hasReviewedFreshness)) return;

        setIsSendingInput(true);
        try {
            await onSendInput(job.id, message, freshnessReviewId);
            setInput('');
        } catch (error) {
            // The panel renders the API error in a stable location.
        } finally {
            setIsSendingInput(false);
        }
    };

    const resultDetails = result && <div className="delegation-job__result-details">
        <div className="delegation-job__result-heading">
            <h4>Result</h4>
            { typeof result.verified === 'boolean' && <span className={ result.verified ? 'is-verified' : 'is-unverified' }>
                <i className={ result.verified ? 'fe fe-check-circle' : 'fe fe-alert-circle' } aria-hidden="true" />
                { result.verified ? 'Verified' : 'Not verified' }
            </span> }
        </div>
        { Array.isArray(result.actions) && result.actions.length > 0 && <ul className="delegation-job__evidence">
            { result.actions.map((action, index) => <li key={ (action.description || 'action') + '-' + index }>
                <strong>{ action.description }</strong>
                { action.evidence && <span>{ formatEvidence(action.evidence) }</span> }
            </li>) }
        </ul> }
        { result.reply_draft && <div className="delegation-job__draft">
            <div>
                <span>{ replyWasSent ? 'Reply sent' : 'Reply draft' }</span>
                <p>{ result.reply_draft }</p>
            </div>
            { canInsertDraft && <button type="button" className="btn btn-white" disabled={ isDraftDisabled } onClick={ () => onInsertDraft(result.reply_draft, result.attachments, { jobId: job.id, proposalId: null }) }>
                <i className="fe fe-edit-3" aria-hidden="true" /> Use
            </button> }
            { replyWasSent && <span className="delegation-job__sent"><i className="fe fe-check-circle" aria-hidden="true" /> Reply sent</span> }
        </div> }
    </div>;

    if (completed) {
        return <section className="delegation-job is-completed" aria-labelledby={ 'delegation-job-' + job.id }>
            <div className="delegation-job__completion">
                <i className="fe fe-check-circle" aria-hidden="true" />
                <div>
                    <h3 id={ 'delegation-job-' + job.id }>{ modeNames[job.mode] || 'Task' } completed</h3>
                    { result?.summary && <p className="delegation-job__summary">{ result.summary }</p> }
                    { authority }
                    { completionNotices[job.delivery_state] && <p className="delegation-job__summary" role="status">{ completionNotices[job.delivery_state] }</p> }
                </div>
            </div>
            <DelegationAttachments attachments={ result?.attachments } />
            <DelegationResultOptions job={ job } isDraftDisabled={ isDraftDisabled || expired } onInsertDraft={ onInsertDraft } onRunFollowUp={ onRunFollowUp } />
            { resultDetails && <details className="delegation-job__disclosure delegation-job__completed-details">
                <summary>Evidence and details</summary>
                { resultDetails }
            </details> }
        </section>;
    }

    return <section className={ 'delegation-job is-' + job.status } aria-labelledby={ 'delegation-job-' + job.id }>
        <div className="delegation-job__topline">
            <div>
                <span className={ 'delegation-status is-' + job.status }>{ statusLabel }</span>
                <h3 id={ 'delegation-job-' + job.id }>{ modeNames[job.mode] || 'Local delegation' }</h3>
                { authority }
            </div>
            { active && <button type="button" className="btn btn-link delegation-job__cancel" onClick={ cancel } disabled={ isCancelling || job.cancel_requested }>
                { job.cancel_requested ? 'Cancellation requested' : isCancelling ? 'Cancelling…' : 'Cancel' }
            </button> }
        </div>

        { active && <div className="delegation-job__activity" aria-live="polite">
            <h4>Live progress</h4>
            <p>{ latestProgress?.message || (job.status === 'queued'
                ? 'Waiting for the paired device to claim this task.'
                : 'The local worker is preparing the delegated work.') }</p>
            { progress.length > 1 && <details className="delegation-job__disclosure">
                <summary>View { progress.length } progress updates</summary>
                <ol>
                    { progress.map((event, index) => <li key={ event.id || index }><span />{ event.message }</li>) }
                </ol>
            </details> }
        </div> }

        { job.status === 'needs_input' && !expired && <div className="delegation-job__input-request">
            <div>
                <h4><i className="fe fe-message-circle" aria-hidden="true" /> Input requested</h4>
                <p>{ result?.question || 'The local worker needs more context before it can continue.' }</p>
            </div>
            <form onSubmit={ submitInput }>
                { freshnessReview && <label className="delegation-job__freshness-review">
                    <input
                        type="checkbox"
                        checked={ hasReviewedFreshness }
                        onChange={ event => setHasReviewedFreshness(event.target.checked) }
                        disabled={ isSendingInput || job.cancel_requested }
                    />
                    <span><strong>Review the current conversation first.</strong> New activity arrived after this reply was prepared. Read the conversation above, then confirm this review before continuing.</span>
                </label> }
                <TextareaAutosize
                    value={ input }
                    onChange={ event => setInput(event.target.value) }
                    placeholder="Send the missing context…"
                    minRows={ 2 }
                    maxRows={ 8 }
                    maxLength={ 4000 }
                    disabled={ isSendingInput || job.cancel_requested }
                />
                <button type="submit" className="btn btn-primary" disabled={ isSendingInput || job.cancel_requested || !input.trim() || Boolean(freshnessReview && !hasReviewedFreshness) }>
                    { isSendingInput ? 'Sending…' : 'Send input' }
                </button>
            </form>
            { inputMessages.length > 0 && <p className="delegation-job__last-input">Last input: { inputMessages[inputMessages.length - 1].message }</p> }
        </div> }

        { result && <div className="delegation-job__result">
            { result.summary && <p className="delegation-job__summary">{ result.summary }</p> }
            { result.provider_error && <div className="delegation-job__provider-error" role="status">
                <strong>Model provider error{ result.provider_error.http_status !== null ? ` · HTTP ${result.provider_error.http_status}` : ' · HTTP status unavailable' }</strong>
                <p>{ result.provider_error.message }</p>
            </div> }
            { resultDetails }
        </div> }
    </section>;
}

DelegationJob.propTypes = {
    isDraftDisabled: PropTypes.bool,
    job: PropTypes.shape({
        cancel_requested: PropTypes.bool,
        delivery_state: PropTypes.string,
        freshness_review: PropTypes.shape({
            latest_last_message_id: PropTypes.string,
            required: PropTypes.bool,
        }),
        id: PropTypes.string.isRequired,
        input_messages: PropTypes.array,
        mode: PropTypes.string,
        progress: PropTypes.array,
        result: PropTypes.object,
        status: PropTypes.string,
    }).isRequired,
    onCancel: PropTypes.func.isRequired,
    onInsertDraft: PropTypes.func.isRequired,
    onSendInput: PropTypes.func.isRequired,
    onRunFollowUp: PropTypes.func.isRequired,
};
