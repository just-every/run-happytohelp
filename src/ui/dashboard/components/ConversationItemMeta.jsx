import React from 'react';
import PropTypes from 'prop-types';
import WorkflowDue from './workflows/WorkflowDue';
import useQuietLine from '../hooks/useQuietLine';
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

// The plan's lines for the parts this row has now; a part the plan has not placed yet joins the last line until the
// next fit, which runs before the browser paints.
function arrange(plan, present) {
    const lines = (plan?.lines || [ [] ]).map(line => line.filter(part => present.includes(part.key)));
    const placed = lines.flat().map(part => part.key);
    lines[lines.length - 1].push(...present.filter(key => !placed.includes(key)).map(key => ({ key, sep: false })));
    return lines;
}

/**
 * A list row's quiet line, for what is not the everyday default: the workspace (Global Inbox only: its switcher colour
 * and name), the ticket's other states, the first tag with "+n", and a due time or snooze. The tag a filter chose leads;
 * the others are the "+n" tooltip and screen-reader text, and the Ticket panel lists them all. useQuietLine places the
 * parts: one line when they fit, otherwise the workspace keeps its dot and what does not fit moves whole to a second
 * line. Every part that can be narrowed carries its full text as its tooltip. Demo workspaces have no ticket states.
 * Nothing renders when there is nothing to add.
 */
function ConversationItemMeta({ conversation, workspace, ticket, leadingTagId }) {
    const [ ref, plan ] = useQuietLine();
    const tags = [ ...(conversation.tags || []) ].sort((a, b) => (String(b.id) === leadingTagId) - (String(a.id) === leadingTagId));
    const [ firstTag, ...moreTags ] = tags;
    const moreNames = moreTags.map(tag => tag.name).join(', ');
    const states = ticket && conversation.status_category ? ticketStates(conversation) : [];
    const due = ticket && (conversation.workflow_sla || conversation.snooze);
    if (!workspace && !states.length && !due && !firstTag) return null;

    const width = key => plan?.widths[key] == null ? undefined : { maxWidth: plan.widths[key] };
    const parts = {
        states: states.length > 0 && <span className="conversation-item-states" data-quiet="states" title={ states.join(' · ') } style={ width('states') }>
            { states.map(state => <span className="conversation-item-state" key={ state }>{ state }</span>) }
        </span>,
        tags: firstTag && <span className="conversation-item-tags" data-quiet="tags">
            <span className="visually-hidden">, tagged </span>
            <span className="conversation-tag" title={ firstTag.name } style={ width('tags') }>{ firstTag.name }</span>
            { moreTags.length > 0 && <span className="conversation-item-more-tags" title={ moreNames }>
                <span aria-hidden="true">+{ moreTags.length }</span>
                <span className="visually-hidden">, also tagged { moreNames }</span>
            </span> }
        </span>,
        due: due && <WorkflowDue sla={ conversation.workflow_sla } snooze={ conversation.snooze } data-quiet="due" style={ width('due') }/>,
    };
    const lines = arrange(plan, Object.keys(parts).filter(key => parts[key])).filter((line, index) => line.length || (index === 0 && workspace));
    const named = plan?.name !== false;

    return <div className="conversation-item-meta" ref={ ref }>
        { lines.map((line, index) => <div className="conversation-item-meta-line" key={ index }>
            { index === 0 && workspace && <span className="conversation-item-workspace" title={ workspace.name }>
                <span className="conversation-item-workspace-dot" style={ { background: workspace.colour || DEFAULT_WORKSPACE_COLOUR } } aria-hidden="true"/>
                <span className={ named ? 'conversation-item-workspace-name' : 'visually-hidden' } data-quiet-name="" style={ typeof plan?.name === 'number' ? { maxWidth: plan.name } : undefined }>{ workspace.name }</span>
            </span> }
            { line.map(part => <React.Fragment key={ part.key }>
                { part.sep && <span className="conversation-item-sep"/> }
                { parts[part.key] }
            </React.Fragment>) }
        </div>) }
    </div>;
}

ConversationItemMeta.propTypes = {
    conversation: PropTypes.object.isRequired,
    workspace: PropTypes.shape({ name: PropTypes.string, colour: PropTypes.string }),
    ticket: PropTypes.bool,
    leadingTagId: PropTypes.string,
};

export default ConversationItemMeta;
