import React from 'react';
import { fieldOptions, label } from './ticket-model';
import {operationalHistory} from './TicketOperationalHistory';

const titles = { status_id: 'Status', status_category: 'Status category', assigned_to: 'Assignee', agent_id: 'Assignee', current_ai_id: 'Assistant', ai_id: 'Assistant', brand_id: 'Brand', group_id: 'Group', requester_id: 'Requester', submitter_id: 'Submitter', submitter_type: 'Submitter type' };
const actorRoles = { user: 'Teammate', agent: 'Teammate', contact: 'Customer', customer: 'Customer', system: 'System', installation: 'Installation', api: 'Workspace API', rule: 'Workflow rule', automation: 'Automation' };
const sources = { dashboard: 'Dashboard', api: 'Workspace API', email: 'Email', widget: 'Chat widget', system: 'System', automation: 'Automation', rule: 'Workflow rule', customer_reply: 'Customer reply', rer: 'Installation' };
const opaque = value => /^(?:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}|[\da-f]{24,})$/i.test(value);
const missing = value => value === null || value === '';
const personName = (person, customer = false) => customer && (person.is_erased || person.is_erasing) ? 'Erased customer' : person.provided_name || person.name || person.display_name || person.provided_email || person.email || (customer ? 'Customer' : 'Teammate');
const recordName = (value, records, unknown) => <span title={String(value)}>{records.find(record => record.id === value)?.name || unknown}</span>;

function plainValue(value) {
    if (value === undefined) return 'Not recorded';
    if (missing(value)) return 'None';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.map((item, index) => <React.Fragment key={index}>{index > 0 && ', '}{plainValue(item)}</React.Fragment>) : 'None';
    if (typeof value === 'object') return 'Historical value unavailable';
    return opaque(String(value)) ? <span title={String(value)}>Recorded identifier</span> : String(value);
}

function HistoryEntry({ item, settings, agents, assistants, conversation, tags }) {
    const changes = item.changes || {}, erased = changes.erased === true;
    const contacts = [conversation.contact, ...(conversation.participants || [])].filter(Boolean);
    const contact = id => contacts.find(person => person.id === id || person.contact_id === id);
    const agent = id => agents.find(person => person.id === id);
    const person = (id, kind) => {
        if (id === undefined || missing(id)) return plainValue(id);
        if (id === 'system') return 'System';
        const knownContact = kind !== 'agent' && contact(id), knownAgent = kind !== 'contact' && agent(id);
        return <span title={String(id)}>{knownContact ? personName(knownContact, true) : knownAgent ? personName(knownAgent) : kind === 'contact' ? 'Historical customer (name unavailable)' : kind === 'agent' ? 'Historical teammate (name unavailable)' : 'Historical submitter (name unavailable)'}</span>;
    };
    let actor = actorRoles[item.actor_type] || 'Unknown actor';
    if (['user', 'agent'].includes(item.actor_type) && agent(item.actor_id)) actor = personName(agent(item.actor_id));
    if (['contact', 'customer'].includes(item.actor_type)) actor = erased ? 'Erased customer' : contact(item.actor_id) ? personName(contact(item.actor_id), true) : 'Customer (name unavailable)';
    const value = (key, recorded, field) => {
        if (recorded === undefined || missing(recorded)) return key === 'assigned_to' && recorded === null ? 'Unassigned' : plainValue(recorded);
        if (field) {
            if (Array.isArray(recorded)) return recorded.length ? recorded.map((option, index) => <React.Fragment key={index}>{index > 0 && ', '}{value(key, option, { ...field, type: 'dropdown' })}</React.Fragment>) : 'None';
            const option = fieldOptions(field).find(option => option.value === recorded);
            return option ? option.label : field.type === 'account' ? 'Account unavailable' : plainValue(recorded);
        }
        if (key === 'requester_id') return person(recorded, 'contact');
        if (key === 'submitter_id') return person(recorded);
        if (['assigned_to', 'agent_id'].includes(key)) return person(recorded, 'agent');
        if (['current_ai_id', 'ai_id'].includes(key)) return recordName(recorded, assistants, 'Historical assistant (name unavailable)');
        if (key === 'status_id') return recordName(recorded, settings.statuses || [], 'Historical status (name unavailable)');
        if (key === 'group_id') return recordName(recorded, settings.groups || [], 'Historical group (name unavailable)');
        if (key === 'brand_id') return recordName(recorded, settings.brands || [], 'Historical brand (name unavailable)');
        if (['priority', 'status_category', 'submitter_type', 'channel'].includes(key)) return opaque(String(recorded)) ? plainValue(recorded) : label(recorded);
        return plainValue(recorded);
    };
    const transition = (key, change, title = titles[key] || label(key), field) => {
        if (!change || typeof change !== 'object' || !('from' in change || 'to' in change)) return <li key={key}>{title} updated; previous details unavailable.</li>;
        if (change.from === change.to) return null;
        return <li key={key} className="mb-1 text-break"><strong>{title}:</strong> {value(key, change.from, field)} <span aria-label="changed to">→</span> {value(key, change.to, field)}</li>;
    };
    const rows = [];
    if (!erased) for (const [key, change] of Object.entries(changes)) {
        if (key === 'erased' || key === 'status_category' && changes.status_id?.from !== changes.status_id?.to) continue;
        const operational = operationalHistory(key, change, changes);
        if (operational !== undefined) { rows.push(operational); continue; }
        if (key === 'fields') {
            for (const [id, fieldChange] of Object.entries(change || {})) {
                const field = settings.fields?.find(field => field.id === id);
                // Never recover or display a value when its field definition is no longer visible.
                rows.push(field ? transition(id, fieldChange, field.name, field) : <li key={`unavailable-${id}`}>A restricted or unavailable field changed.</li>);
            }
        } else if (key === 'tags') {
            for (const action of ['add', 'remove']) if (change?.[action]?.length) rows.push(<li key={`tags-${action}`}><strong>Tags {action === 'add' ? 'added' : 'removed'}:</strong> {change[action].map((id, index) => <React.Fragment key={`${id}-${index}`}>{index > 0 && ', '}{recordName(id, tags, 'Historical tag (name unavailable)')}</React.Fragment>)}</li>);
        } else rows.push(transition(key, change));
    }
    const date = new Date(item.at), validTime = Number.isFinite(date.getTime());
    return <li>
        <span title={erased && ['contact', 'customer'].includes(item.actor_type) ? undefined : item.actor_id || undefined}>{actor}</span> · <span title={item.source}>{sources[item.source] || 'Other recorded source'}</span>
        {validTime ? <time dateTime={date.toISOString()}>{date.toLocaleString()}</time> : <span>Time unavailable</span>}
        {erased ? <p className="form-text">Change details removed after contact erasure.</p> : rows.some(Boolean) ? <ul className="list-unstyled mt-1">{rows}</ul> : <p className="form-text">No visible field changes recorded.</p>}
    </li>;
}

/** Ticket › History: every status and field change, who made it, from where and when. */
export default function TicketHistory({ history = [], settings, agents = [], assistants = [], conversation }) {
    const tags = [...(conversation.tags || []), ...(settings.tags || [])];
    return <section className="ticket-history-block" aria-label="Status and field history"><h4 className="ticket-panel-subheading">Status and field history</h4>{history.length ? <ol className="ticket-history">{history.map(item => <HistoryEntry key={item.id} {...{item, settings, agents, assistants, conversation, tags}}/>)}</ol> : <p className="form-text">No changes recorded.</p>}</section>;
}
