import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import ContactAvatar from './ContactAvatar';
import TimeAgo from 'react-timeago';
import { ChatContext } from '../contexts/ChatContext';
import CountryName from './includes/CountryName';
import Moment from '../../native/ZonedMoment';
import { contactTimezone } from '../utils/contactTimezone';

import { useCan } from './ConversationAccess';
import '../styles/components/ConversationHeader.scss';
import { tooltip } from '../../../modules/tooltip/tooltip';

ConversationHeader.propTypes = {
    conversation: PropTypes.object,
    atTop: PropTypes.bool,
    hasPanelAlert: PropTypes.bool,
    isPanelVisible: PropTypes.bool,
    onPanelToggle: PropTypes.func,
    panelToggleRef: PropTypes.object,
};

export default function ConversationHeader({
    conversation,
    atTop,
    hasPanelAlert,
    isPanelVisible,
    onPanelToggle,
    panelToggleRef,
}) {
    const { getProject, isGlobalInbox, resolveConversation, resolvingConversations, setIsMainVisible } = useContext(ChatContext);
    const projectName = isGlobalInbox ? getProject(conversation.project_id).name : null;
    const isAiAssigned = Boolean(conversation.ai_id);
    // A Closed ticket is final: nothing reopens it, and customer replies open a new ticket.
    const isFinal = conversation.status_category === 'closed';
    const statusLabel = isFinal ? 'Closed · final' : conversation.resolved_at ? 'Closed' : 'Open';
    const canManage = useCan(conversation.project_id, 'conversations.manage');
    const contactEmail = conversation.contact.email && conversation.contact.email !== conversation.contact.display_name
        ? conversation.contact.email
        : conversation.contact.provided_email && conversation.contact.provided_email !== conversation.contact.display_name
            ? conversation.contact.provided_email
            : null;

    const timezone = contactTimezone(conversation.contact);
    const projectHref = `/projects/${conversation.project_id}/conversations/${conversation.id}`;
    // The contact's clock is shown only when a timezone is recorded; the viewer's own clock is never substituted.
    const metaItems = [
        projectName && { key: 'project', node: <a className="conversation-header-project conversation-header-meta-project" href={ projectHref } title={ projectName }>{ projectName }</a> },
        contactEmail && { key: 'email', node: <span className="conversation-header-meta-email" title={ contactEmail }>{ contactEmail }</span> },
        timezone && { key: 'time', node: <span className="conversation-header-meta-fixed"><Moment tz={ timezone } format="LT">{ new Date() }</Moment></span> },
        conversation.contact.country_code && { key: 'country', node: <span className="conversation-header-meta-fixed"><CountryName code={ conversation.contact.country_code } prefix /></span> },
    ].filter(Boolean);
    const contactName = conversation.contact.display_name;
    const panelLabel = isPanelVisible ? 'Hide conversation panel' : 'Show conversation panel';
    // While the panel is closed, a small dot says the ticket summary has an alert (an SLA alert or a customer update to review).
    const showAlert = Boolean(hasPanelAlert) && !isPanelVisible;

    return (
        <div className={ `chat-header conversation-header${atTop ? '' : ' is-scrolled'}` }>
            <div className="conversation-header-panel">
                <div className="conversation-header-identity">
                    <button type="button" className="conversation-header-back nav-link d-xl-none" { ...tooltip('Show conversations', 'right') } onClick={ () => setIsMainVisible(false) }>
                        <i className="icon-md fe fe-chevron-left" aria-hidden="true"></i>
                    </button>
                    <ContactAvatar contact={ conversation.contact } href={ `/projects/${conversation.project_id}/contacts/${conversation.contact_id}` } label="View contact" className="avatar avatar-sm" presentation="conversation-profile" />
                    <div className="conversation-header-identity-copy">
                        <div className="conversation-header-name-row">
                            <a className="chat-header-title" href={ `/projects/${conversation.project_id}/contacts/${conversation.contact_id}` } title={ contactName }>{ contactName }</a>
                        </div>
                        <div className="conversation-header-meta">
                            { metaItems.map((item, index) => <React.Fragment key={ item.key }>
                                { index > 0 && <span className="conversation-header-meta-separator" aria-hidden="true">•</span> }
                                { item.node }
                            </React.Fragment>) }
                        </div>
                    </div>
                </div>
                <div className="conversation-header-chips">
                    { conversation.contact.unverified_sender
                        ? <span className="badge text-bg-danger-subtle" title="This email's From address was not authenticated, so it is kept apart from the customer who uses that address. Replies go only to that address.">Unverified sender</span>
                        : conversation.contact.is_verified ? <span className="badge text-bg-primary">Verified</span> : <span className="badge text-bg-secondary-subtle">Unverified</span> }
                    { conversation.resolved_at
                        ? <OverlayTrigger placement="bottom" overlay={ <Tooltip id={ `${conversation.id}-resolved-at` }><TimeAgo date={ conversation.resolved_at } /></Tooltip> }><span className={ `conversation-header-status is-closed${ isFinal ? ' is-final' : '' }` } title={ isFinal ? 'Closed tickets are final. A customer reply opens a new ticket.' : undefined }>{ statusLabel }</span></OverlayTrigger>
                        : <span className="conversation-header-status is-open">{ statusLabel }</span> }
                    { isAiAssigned && <span className="conversation-header-status is-ai">AI</span> }
                </div>
                <div className="conversation-header-actions">
                    { canManage && !isFinal && (conversation.resolved_at
                        ? <button type="button" className="btn btn-white conversation-header-reopen" title="Reopen conversation" disabled={ Boolean(resolvingConversations?.[conversation.id]) } onClick={ () => resolveConversation(conversation, false).catch(() => {}) }><i className="fe fe-rotate-ccw me-2" aria-hidden="true"></i>Reopen</button>
                        : <button type="button" className="btn btn-white conversation-header-close" title="Close conversation" disabled={ Boolean(resolvingConversations?.[conversation.id]) } onClick={ () => resolveConversation(conversation).catch(() => {}) }><i className="fe fe-check-circle me-2" aria-hidden="true"></i>Close</button>) }
                    <button
                        type="button"
                        className={ `btn btn-white conversation-assistant-toggle${ showAlert ? ' has-alert' : '' }` }
                        ref={ panelToggleRef }
                        { ...tooltip(panelLabel) }
                        aria-description={ `Suggest, Delegate and Ticket.${ showAlert ? ' The ticket summary has an alert.' : '' }` }
                        aria-controls="conversation-assistant"
                        aria-expanded={ Boolean(isPanelVisible) }
                        onClick={ onPanelToggle }>
                        <i className="fe fe-sidebar conversation-assistant-toggle__icon" aria-hidden="true"></i>
                        { showAlert && <span className="conversation-assistant-toggle__dot" aria-hidden="true" /> }
                    </button>
                </div>
            </div>
        </div>
    );
}
