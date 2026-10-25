import React, { useContext, useId, useState } from 'react';
import PropTypes from 'prop-types';
import { ChatContext } from '../../contexts/ChatContext';
import ReplyIcon from '../reply-icons/ReplyIcon';
import { nativeRequest } from '../../../native/transport';
import SlateInquiryLink from '../../../native/SlateInquiryLink';
import { EmailFollowupLink, useEmailFollowups } from '../EmailFollowups';
import useCollaboration from '../collaboration/useCollaboration';
import ConversationAssignmentControl from '../conversation/ConversationAssignmentControl';
import ConversationParticipantsControl from '../conversation/ConversationParticipantsControl';
import ConversationTags from '../conversation/ConversationTags';
import { json, label, priorities } from '../tickets/ticket-model';
import { FollowupLinks, RoutingExplanation, operatorsFor } from '../workflows/WorkflowPanel';
import { nextSlaDue } from '../workflows/SlaStatus';
import { workflowTime } from '../workflows/schedule-time';

function Row({ label: name, children, className = '' }) {
    return <div className={ `ticket-summary__row ${ className }` }><dt>{ name }</dt><dd>{ children }</dd></div>;
}

/** Status or Priority: saved the moment it changes, against the version the agent saw. */
function TicketChoice({ id, name, value, options, disabled, onSave }) {
    const [ pending, setPending ] = useState(null), [ error, setError ] = useState(''), [ saved, setSaved ] = useState('');
    const change = async event => {
        const next = event.target.value;
        setPending(next); setError(''); setSaved('');
        try { await onSave(next); setSaved(`${ name } saved.`); } catch (failure) { setError(failure.message); } finally { setPending(null); }
    };
    return <div className="ticket-summary__row ticket-summary__row--choice">
        <dt><label htmlFor={ id }>{ name }</label></dt>
        <dd>
            <span className="ticket-summary__choice">
                <select id={ id } className="ticket-summary__select" value={ pending ?? value ?? '' } disabled={ disabled || pending !== null } onChange={ change }>
                    { options.map(option => <option key={ option.value } value={ option.value }>{ option.label }</option>) }
                </select>
                { !disabled && <ReplyIcon name="chevron-right" className="ticket-summary__chevron" /> }
            </span>
            { error && <p role="alert" className="ticket-summary__error">{ error }</p> }
            <p role="status" className="visually-hidden">{ saved }</p>
        </dd>
    </div>;
}

/**
 * Ticket › Summary, the panel's first card: assignee (with why it was routed), status and priority, tags, recipients,
 * SLA, followers, follow-ups and Slate. In a demo project the ticket and workflow rows stay hidden, as today.
 */
export default function TicketSummary({ conversation, record, workflows, escalationUpdates, onOpenSection }) {
    const { agentsFor, currentAgent } = useContext(ChatContext);
    const collaboration = useCollaboration();
    const routedId = useId();
    const [ routedOpen, setRoutedOpen ] = useState(false);
    const ticket = record?.ticket, settings = record?.settings;
    const closed = ticket?.status_category === 'closed';
    const sla = workflows?.sla.data?.data;
    const due = nextSlaDue(sla);
    const openAlerts = (sla?.alerts || []).filter(alert => alert.state === 'open');
    // Ticket management acknowledges SLA alerts and reads the routing decision ("Why routed").
    const manage = workflows?.schedules.data?.data.permissions?.manage === true;
    const acknowledge = alert => workflows.sla.run(() => nativeRequest(`${ workflows.base }/sla-alerts/${ encodeURIComponent(alert.id) }/ack`, json('PATCH', {})));
    const followers = collaboration.followers.map(person => person.id === currentAgent?.id ? 'You' : person.name);
    const emailFollowups = useEmailFollowups(conversation.project_id, conversation.id);
    const workflowFollowups = Boolean(workflows && (workflows.schedules.data?.data.followup_of || workflows.schedules.data?.data.followups?.length > 0));
    const statuses = (settings?.statuses || []).filter(status => status.active || status.id === ticket?.status_id)
        .map(status => ({ value: status.id, label: status.name === label(status.category) ? status.name : `${ status.name } (${ label(status.category) })` }));
    return <section className="ticket-summary" aria-labelledby="ticket-summary-title">
        <h3 id="ticket-summary-title" className="ticket-summary__title">Summary</h3>
        { record?.error && <p role="alert" className="ticket-summary__error">{ record.error }</p> }
        <dl className="ticket-summary__rows">
            <Row label="Assignee" className="ticket-summary__row--assignee">
                <ConversationAssignmentControl conversation={ conversation } />
                { workflows && manage && <>
                    <button type="button" className="btn btn-link ticket-summary__why" aria-expanded={ routedOpen } aria-controls={ routedId } onClick={ () => setRoutedOpen(open => !open) }>Why routed</button>
                    <div id={ routedId } hidden={ !routedOpen }><RoutingExplanation routing={ workflows.routing } agents={ operatorsFor(agentsFor, conversation.project_id) } /></div>
                </> }
            </Row>
            { record && ticket && settings && <>
                <TicketChoice id="ticket-summary-status" name="Status" value={ ticket.status_id } options={ statuses } disabled={ !record.manage || closed } onSave={ status_id => record.save({ status_id }) } />
                <TicketChoice id="ticket-summary-priority" name="Priority" value={ ticket.priority } options={ priorities.map(value => ({ value, label: label(value) })) } disabled={ !record.manage || closed } onSave={ priority => record.save({ priority }) } />
            </> }
            { record && !ticket && !record.error && <Row label="Status"><span role="status">Loading ticket…</span></Row> }
            <Row label="Tags"><ConversationTags conversation={ conversation } /></Row>
            <Row label="Recipients"><ConversationParticipantsControl conversation={ conversation } /></Row>
            { (due || openAlerts.length > 0) && <Row label="SLA" className={ due?.breached || openAlerts.length ? 'is-alert' : '' }>
                { due && <span className={ due.breached ? 'text-danger' : undefined }>{ due.text }</span> }
                { openAlerts.map(alert => <div className="ticket-summary__alert" key={ alert.id }>
                    <span>{ label(alert.kind) } · { label(alert.metric) } · { workflowTime(alert.created_at) }</span>
                    { manage && <button type="button" className="btn btn-sm btn-white" disabled={ workflows.sla.busy } onClick={ () => acknowledge(alert) }>Acknowledge</button> }
                </div>) }
            </Row> }
            { escalationUpdates > 0 && <Row label="Update" className="is-alert">
                <div className="ticket-summary__alert">
                    <span>{ escalationUpdates === 1 ? 'A customer update is ready to review' : `${ escalationUpdates } customer updates are ready to review` }</span>
                    <button type="button" className="btn btn-sm btn-white" onClick={ () => onOpenSection('escalations') }>Review</button>
                </div>
            </Row> }
            <Row label="Followers">{ collaboration.error ? <span className="text-danger" role="alert">{ collaboration.error }</span> : !collaboration.loaded ? <span role="status">Loading…</span> : followers.length ? followers.join(', ') : 'None' }</Row>
            { (workflowFollowups || emailFollowups.links.length > 0) && <Row label="Follow-ups">
                { emailFollowups.links.length > 0 && <ul className="workflow-followups">{ emailFollowups.links.map(link => <li key={ link.conversation_id }><EmailFollowupLink projectId={ conversation.project_id } conversationId={ conversation.id } link={ link } /></li>) }</ul> }
                { workflowFollowups && <FollowupLinks conversation={ conversation } schedules={ workflows.schedules } /> }
            </Row> }
            { ticket?.api && <Row label="Source"><span>Created via { ticket.api.source_product } by { ticket.api.credential_name }</span>{ ticket.api.source_url && <a href={ ticket.api.source_url } target="_blank" rel="noopener noreferrer">Open in { ticket.api.source_product }</a> }</Row> }
            <SlateInquiryLink conversation={ conversation } />
            { conversation.imported && <Row label="Imported">
                { conversation.imported.subject && <p className="import-source-note">Source subject: { conversation.imported.subject }</p> }
                <p className="import-source-note">Imported from { conversation.imported.vendor }; source { conversation.imported.source_id }, { conversation.imported.source_state }. Excluded from Reports.</p>
            </Row> }
        </dl>
    </section>;
}

TicketSummary.propTypes = {
    conversation: PropTypes.object.isRequired,
    record: PropTypes.object,
    workflows: PropTypes.object,
    escalationUpdates: PropTypes.number,
    onOpenSection: PropTypes.func.isRequired,
};
