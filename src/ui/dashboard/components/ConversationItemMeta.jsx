import React from 'react';
import PropTypes from 'prop-types';
import WorkflowDue from './workflows/WorkflowDue';
import { label } from './tickets/ticket-model';
import { DEFAULT_WORKSPACE_COLOUR } from '../../../modules/management/workspace-colour';

// The everyday statuses a row leaves unsaid: New and Open while it is worked, Solved once the row's closed mark shows it.
const QUIET_STATUSES = [ 'new', 'open', 'solved' ];

/** The ticket states a row names: a status other than New, Open or Solved, and a priority other than Normal. */
export function ticketStates(conversation) {
    const states = [];
    if (!QUIET_STATUSES.includes(conversation.status?.id ?? conversation.status_category)) states.push(conversation.status?.name || label(conversation.status_category));
    if (conversation.priority && conversation.priority !== 'normal') states.push(conversation.priority === 'urgent' ? 'Urgent' : `${ label(conversation.priority) } priority`);
    return states;
}

/**
 * A list row's quiet line, for what is not the everyday default: the workspace (Global Inbox only: its switcher colour
 * and name), the ticket's other states, a due time or snooze, and the first tag with "+n". The tag a filter chose leads;
 * the others are the "+n" tooltip and screen-reader text, and the Ticket panel lists them all. Demo workspaces have no
 * ticket states. Nothing renders when there is nothing to add.
 */
function ConversationItemMeta({ conversation, workspace, ticket, leadingTagId }) {
    const tags = [ ...(conversation.tags || []) ].sort((a, b) => (String(b.id) === leadingTagId) - (String(a.id) === leadingTagId));
    const [ firstTag, ...moreTags ] = tags;
    const moreNames = moreTags.map(tag => tag.name).join(', ');
    const states = ticket && conversation.status_category ? ticketStates(conversation) : [];
    const due = ticket && (conversation.workflow_sla || conversation.snooze);
    if (!workspace && !states.length && !due && !firstTag) return null;

    return <div className="conversation-item-meta">
        { workspace && <span className="conversation-item-workspace">
            <span className="conversation-item-workspace-dot" style={ { background: workspace.colour || DEFAULT_WORKSPACE_COLOUR } } aria-hidden="true"/>
            <span className="conversation-item-workspace-name">{ workspace.name }</span>
        </span> }
        { states.map(state => <span className="conversation-item-state" key={ state }>{ state }</span>) }
        { due && <WorkflowDue sla={ conversation.workflow_sla } snooze={ conversation.snooze }/> }
        { firstTag && <span className="conversation-item-tags">
            <span className="conversation-tag">{ firstTag.name }</span>
            { moreTags.length > 0 && <span className="conversation-item-more-tags" title={ moreNames }>
                <span aria-hidden="true">+{ moreTags.length }</span>
                <span className="visually-hidden">, also tagged { moreNames }</span>
            </span> }
        </span> }
    </div>;
}

ConversationItemMeta.propTypes = {
    conversation: PropTypes.object.isRequired,
    workspace: PropTypes.shape({ name: PropTypes.string, colour: PropTypes.string }),
    ticket: PropTypes.bool,
    leadingTagId: PropTypes.string,
};

export default ConversationItemMeta;
