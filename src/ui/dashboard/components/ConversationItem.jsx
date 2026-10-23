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
import ConversationItemMeta from "./ConversationItemMeta";
import { OverlayTrigger } from "react-bootstrap";
import Tooltip from "react-bootstrap/Tooltip";

import '../styles/components/ConversationItem.scss';
import { tooltip } from '../../../modules/tooltip/tooltip';

// One inbox row (H16): the name and time; the message on one line with the assignee's initial and the unread count;
// then a quiet line for what is not the everyday default (ConversationItemMeta; a second only when its parts need it).
export const conversationNameId = id => `conversation-${ id }-name`;

function ConversationItem({ conversation }) {
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
    const project = settings.projects?.[conversation.project_id];
    const workspaceName = isGlobalInbox ? getProject(conversation.project_id).name : null;
    const workspace = workspaceName ? { name: workspaceName, colour: project?.primary_color } : null;
    const isDemo = (project || settings.project)?.is_demo;
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

    const isResolved = Boolean(conversation.resolved_at);
    const isFinal = conversation.status_category === 'closed';
    const resolutionError = resolutionErrors?.[conversation.id];
    const actionLabel = isResolved ? 'Reopen conversation' : 'Close conversation';
    // The row's Close and its Select tickets checkbox (ConversationsList) are described by the contact's name.
    const nameId = conversationNameId(conversation.id);
    const subject = !isDemo && conversation.subject;

    // The action is a sibling of the row link (a button inside an anchor is invalid). It shows on hover and keyboard
    // focus, in the time's place.
    return (
        <div className="conversation-item-wrap">
        <Link to={conversationUrl} search={search}
              onClick={handleClick}
              className={ 'conversation-item text-reset nav-link p-0 ' + (urlConversationId === conversation.id ? 'active' : '') }>
            <div className="card">
                <div className="card-body">
                    <div className="row">
                        <div className="col-auto">
                            { conversation.contact && <ContactAvatar contact={ conversation.contact } projectId={ conversation.project_id } presentation="conversation-profile" /> }
                        </div>
                        <div className="col overflow-hidden">
                            <div className="conversation-item-heading">
                                <h4 id={ nameId }>{ conversation.contact ? conversation.contact.display_name : '' }</h4>
                                { lastMessageDate && <span className="conversation-item-time">
                                    <Moment format={ lastMessageIsToday ? "LT" : "D MMM" } date={ lastMessageDate } />
                                </span> }
                                { conversation.resolved_at && <OverlayTrigger
                                    placement="right"
                                    overlay={
                                        <Tooltip id={ `${ conversation.id }-resolved-at` }>Closed <TimeFormat date={ conversation.resolved_at }/></Tooltip>
                                    }>
                                    <i className="conversation-item-closed fe fe-check-circle"></i>
                                </OverlayTrigger> }
                            </div>
                            <div className="conversation-item-preview">
                                { (subject || conversation.last_message) && <div className="conversation-item-text">
                                    { subject && <span className="conversation-item-subject">{ subject }</span> }
                                    { conversation.last_message && <span className="conversation-item-message">
                                        { !conversation.matched_message && conversation.last_message.agent && <span className="conversation-item-author">{ conversation.last_message.agent.name }: </span> }
                                        { (conversation.matched_message || conversation.last_message).content }
                                    </span> }
                                </div> }
                                { conversation.agent && <span className="conversation-item-agent" role="img" title={ `Assigned to ${ conversation.agent.name }` } aria-label={ `Assigned to ${ conversation.agent.name }` }>
                                    <AgentAvatar agent={ conversation.agent } className="avatar-xs" projectId={ conversation.project_id } />
                                </span> }
                                { conversation.unread_contact_messages_count > 0 && <span className="conversation-item-unread" aria-label={ `${ conversation.unread_contact_messages_count } unread messages` }>
                                    { conversation.unread_contact_messages_count > 99 ? '99+' : conversation.unread_contact_messages_count }
                                </span> }
                            </div>
                            <ConversationItemMeta conversation={ conversation } workspace={ workspace } ticket={ !isDemo } leadingTagId={ search.tag == null ? undefined : String(search.tag) } />
                        </div>
                    </div>
                </div>
            </div>
        </Link>
        { !isFinal && <button type="button" className="conversation-item-action btn btn-white" { ...tooltip(actionLabel, { placement: 'left', describedBy: nameId }) } onClick={ event => handleResolve(event, !isResolved) }>
            <i className={ `fe ${ isResolved ? 'fe-rotate-ccw' : 'fe-check-circle' }` } aria-hidden="true"></i>
        </button> }
        { resolutionError && urlConversationId !== conversation.id && <p className="conversation-item-error" role="alert">{ resolutionError }</p> }
        </div>
    );
}

ConversationItem.propTypes = {
    conversation: PropTypes.object,
};

export default ConversationItem;
