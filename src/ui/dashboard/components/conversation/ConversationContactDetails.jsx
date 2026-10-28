import React, { useRef, useState } from 'react';
import PropTypes from 'prop-types';
import TimeAgo from 'react-timeago';
import useOnclickOutside from 'react-cool-onclickoutside';
import ReplyIcon from '../reply-icons/ReplyIcon';
import ConversationDetailField from './ConversationDetailField';
import ConversationDetailSection from './ConversationDetailSection';
import HubSpotContext from '../../../native/crm/HubSpotContext';
import address from './emailAddress';
import { tooltip } from '../../../../modules/tooltip/tooltip';

const contactPath = (conversation, contact) => `/projects/${ conversation.project_id }/contacts/${ contact.id }`;

export default function ConversationContactDetails({ conversation, onEdit, onEmailTranscript, onToggleBlock }) {
    const { contact } = conversation;
    const name = contact.name || contact.provided_name;
    const email = contact.email || contact.provided_email;
    const hasDifferentProvidedName = contact.name && contact.provided_name && contact.name.trim() !== contact.provided_name.trim();
    const hasDifferentProvidedEmail = contact.email && contact.provided_email && contact.email.trim().toLowerCase() !== contact.provided_email.trim().toLowerCase();
    const [actionsOpen, setActionsOpen] = useState(false);
    const actionsButtonRef = useRef(null);
    const actionsRef = useOnclickOutside(() => setActionsOpen(false));
    const handleAction = action => {
        setActionsOpen(false);
        action();
    };
    const handleActionsKeyDown = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        setActionsOpen(false);
        actionsButtonRef.current?.focus();
    };

    return <><ConversationDetailSection className="conversation-details-contact" title="Contact">
        { name && <ConversationDetailField className="conversation-detail-field--primary" icon="user" label="Name">
            <a href={ contactPath(conversation, contact) }>{ name }</a>
            { hasDifferentProvidedName && <a href={ contactPath(conversation, contact) } className="conversation-detail-field__secondary-value">{ contact.provided_name }</a> }
        </ConversationDetailField> }
        { !name && contact.display_name !== contact.id && <ConversationDetailField className="conversation-detail-field--primary" icon="user" label="Generated name">
            <a href={ contactPath(conversation, contact) }>{ contact.display_name }</a>
        </ConversationDetailField> }
        { email && <ConversationDetailField className="conversation-detail-field--primary" icon="mail" label="Email">
            <a href={ `mailto:${ email }` }>{ address(email) }</a>
            <small className="d-block text-muted">Replies go to {address(contact.provided_email || email)}. Delivery status appears below each reply.{hasDifferentProvidedEmail && ' This supplied reply address does not change the signed identity.'}</small>
            { hasDifferentProvidedEmail && <a href={ `mailto:${ contact.provided_email }` } className="conversation-detail-field__secondary-value">{ address(contact.provided_email) }</a> }
        </ConversationDetailField> }
        <ConversationDetailField
            className="conversation-detail-field--primary"
            icon="circle-check"
            label="Signed identity"
            value={ contact.is_verified ? 'Verified by your website' : 'Visitor provided · email replies allowed' }
        />

        <div className="conversation-details-contact-actions btn-group dropdown" ref={ actionsRef } onKeyDown={ handleActionsKeyDown }>
            <button type="button" className="btn btn-white" onClick={ onEdit }>
                <ReplyIcon name="pencil" /> Edit contact
            </button>
            <button type="button" className="btn btn-white dropdown-toggle dropdown-toggle-split" ref={ actionsButtonRef } { ...tooltip('Contact actions') } aria-haspopup="menu" aria-expanded={ actionsOpen } onClick={ () => setActionsOpen(open => !open) }>
                <ReplyIcon name="chevron-down" />
            </button>
            { actionsOpen && <ul className="dropdown-menu show" role="menu">
                { contact.is_blocked && <li role="none"><button type="button" role="menuitem" className="dropdown-item" onClick={ () => handleAction(() => onToggleBlock(false)) }>Unblock contact</button></li> }
                { !contact.is_blocked && <li role="none"><button type="button" role="menuitem" className="dropdown-item" onClick={ () => handleAction(() => onToggleBlock(true)) }>Block contact</button></li> }
                <li role="none"><button type="button" role="menuitem" className="dropdown-item" onClick={ () => handleAction(onEmailTranscript) }>Email conversation</button></li>
            </ul> }
        </div>

        <div className="conversation-detail-grid">
            <ConversationDetailField className="conversation-detail-field--compact" icon="calendar" label="First seen" value={ <TimeAgo date={ contact.created_at } /> } />
            <ConversationDetailField
                className="conversation-detail-field--compact"
                icon="clock"
                label="Last seen"
                value={ contact.is_online ? <span className="conversation-detail-field__online">Online</span> : <TimeAgo date={ contact.last_seen_at || new Date() } /> }
            />
            { contact.blocked_at && <ConversationDetailField className="conversation-detail-field--compact" icon="ban" label="Blocked" value={ <TimeAgo date={ contact.blocked_at } /> } /> }
        </div>
    </ConversationDetailSection><HubSpotContext projectId={conversation.project_id} contact={contact} conversationId={conversation.id}/></>;
}

ConversationContactDetails.propTypes = {
    conversation: PropTypes.object.isRequired,
    onEdit: PropTypes.func.isRequired,
    onEmailTranscript: PropTypes.func.isRequired,
    onToggleBlock: PropTypes.func.isRequired,
};
