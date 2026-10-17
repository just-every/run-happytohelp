import WorkflowDue from './workflows/WorkflowDue';
import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { Link } from '@tanstack/react-router';
import { useDashboardLocation, useDashboardSettings } from '../../native/dashboard-state';
import useInboxRoute from '../hooks/useInboxRoute';
import moment from 'moment';
import Moment from '../../native/Moment';
import { ChatContext } from "../contexts/ChatContext";
import TimeFormat from "./includes/TimeFormat";
import ContactAvatar from "./ContactAvatar";
import AgentAvatar from "./AgentAvatar";
import { OverlayTrigger } from "react-bootstrap";
import Tooltip from "react-bootstrap/Tooltip";

import '../styles/components/ConversationItem.scss';

function ConversationItem({ conversation, setConversation }) {
    const {
        setIsMainVisible,
        resolveConversation,
        resolutionErrors,
        isGlobalInbox,
        getProject,
    } = useContext(ChatContext)
    const { urlProjectId, urlConversationId } = useInboxRoute();
    const { search } = useDashboardLocation();
    const settings = useDashboardSettings();

    // The global inbox has no project in its URL - conversations live under /conversations
    const conversationUrl = isGlobalInbox
        ? `/conversations/${ conversation.id }`
        : `/projects/${ urlProjectId }/conversations/${ conversation.id }`;
    const projectName = isGlobalInbox ? getProject(conversation.project_id).name : null;
    const lastMessageDate = conversation.last_message?.created_at;
    const lastMessageIsToday = lastMessageDate && moment(lastMessageDate).isSame(moment(), 'day');

    const handleClick = () => {
        setIsMainVisible(true);
    }

    const handleResolve = (event, resolved) => {
        event.preventDefault();
        event.stopPropagation();
        resolveConversation(conversation, resolved).catch(() => {});
    }

    const contactName = conversation.contact?.display_name || 'contact';
    const isResolved = Boolean(conversation.resolved_at);
    const isFinal = conversation.status_category === 'closed';
    const resolutionError = resolutionErrors?.[conversation.id];
    const actionLabel = isResolved ? 'Reopen' : 'Close';

    // The action is a sibling of the row link (a button inside an anchor is invalid) and lives in
    // its own reserved column, so it never covers the time, avatar or badges.
    return (
        <div className="conversation-item-wrap">
        <Link to={conversationUrl} search={search}
              onClick={handleClick}
              className={ 'conversation-item text-reset nav-link p-0 ' + (urlConversationId === conversation.id ? 'active' : '') }>
            <div className="card">
                <div className="card-body">
                    <div className="row align-items-center">
                        <div className="col-auto align-self-start">
                            { conversation.contact && <ContactAvatar contact={ conversation.contact } projectId={ conversation.project_id } presentation="conversation-profile" /> }
                        </div>
                        <div className="col overflow-hidden">
                            <div className="conversation-item-heading d-flex align-items-center mb-1">
                                <h4 className="text-truncate mb-0 me-auto">{ conversation.contact ? conversation.contact.display_name : '' }</h4>
                                { lastMessageDate && <span className="conversation-item-time small text-muted text-nowrap ms-2">
                                    <Moment format={ lastMessageIsToday ? "LT" : "D MMM" } date={ lastMessageDate } />
                                </span> }
                                { conversation.resolved_at && <OverlayTrigger
                                    placement="right"
                                    overlay={
                                        <Tooltip id={ `${ conversation.id }-resolved-at` }>Closed <TimeFormat date={ conversation.resolved_at }/></Tooltip>
                                    }>
                                    <i className="fe fe-check-circle text-success ms-2 font-weight-bold"></i>
                                </OverlayTrigger> }
                            </div>
                            { projectName && <div className="conversation-item-meta d-flex align-items-center mb-1">
                                <span className="badge conversation-item-project text-truncate">{ projectName }</span>
                            </div> }
                            {conversation.status_category && !(settings.projects?.[conversation.project_id] || settings.project)?.is_demo && <div className="ticket-row-meta"><span>{conversation.status?.name || conversation.status_category.replaceAll('_', ' ')}</span><span>{conversation.priority}</span>{conversation.subject && <span className="text-truncate">{conversation.subject}</span>}</div>}
                            {!(settings.projects?.[conversation.project_id] || settings.project)?.is_demo && <WorkflowDue sla={conversation.workflow_sla} snooze={conversation.snooze}/>}
                            <div className="conversation-tags">{(conversation.tags||[]).map(tag=><span className="conversation-tag" key={tag.id}>{tag.name}</span>)}</div>
                            <div className="conversation-item-preview d-flex align-items-center">
                                { conversation.last_message && <div className="text-truncate me-auto">
                                    { !conversation.matched_message && conversation.last_message.agent && <h4 className="d-inline">{ conversation.last_message.agent.name }: </h4> }
                                    { (conversation.matched_message || conversation.last_message).content}
                                </div> }
                                { conversation.agent && <span className="conversation-item-agent" role="img" title={ `Assigned to ${ conversation.agent.name }` } aria-label={ `Assigned to ${ conversation.agent.name }` }>
                                    <AgentAvatar agent={ conversation.agent } className="avatar-xs" projectId={ conversation.project_id } />
                                </span> }
                                { conversation.unread_contact_messages_count > 0 && <span className="conversation-item-unread" aria-label={ `${ conversation.unread_contact_messages_count } unread messages` }>
                                    { conversation.unread_contact_messages_count > 99 ? '99+' : conversation.unread_contact_messages_count }
                                </span> }
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Link>
        { !isFinal && <OverlayTrigger
            placement="left"
            overlay={ <Tooltip id={ `${ conversation.id }-resolved` } className={(urlConversationId === conversation.id ? 'tooltip-light' : 'tooltip-dark')}>{ actionLabel }</Tooltip> }>
            <button type="button" className="conversation-item-action btn btn-white" aria-label={ `${ actionLabel } conversation with ${ contactName }` } onClick={ event => handleResolve(event, !isResolved) }>
                <i className={ `fe ${ isResolved ? 'fe-rotate-ccw' : 'fe-check-circle' }` } aria-hidden="true"></i>
            </button>
        </OverlayTrigger> }
        { resolutionError && urlConversationId !== conversation.id && <p className="conversation-item-error" role="alert">{ resolutionError }</p> }
        </div>
    );
}

ConversationItem.propTypes = {
    conversation: PropTypes.object,
};

export default ConversationItem;
