import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { useDashboardSettings } from '../../../native/dashboard-state';
import { identityLinks, identityName, identityUnavailable, proofLabel } from '../../../native/pages/companies/identity-link-api';
import ConversationDetailField from '../conversation/ConversationDetailField';
import ConversationDetailSection from '../conversation/ConversationDetailSection';

/** The requester's reviewed "possibly the same customer" links, as context only. Read once the Customer section opens. */
export default function PossiblySameCustomer({ projectId, contact, active }) {
    const allowed = (useDashboardSettings().projects?.[projectId]?.access?.permissions || []).includes('contacts.manage') && !identityUnavailable(contact);
    const contactId = contact.id;
    const [ state, setState ] = useState({ key: null, links: null, error: '' });
    const key = `${ projectId }/${ contactId }`;
    useEffect(() => {
        if (!allowed || !active || state.key === key) return undefined;
        let current = true;
        identityLinks(projectId, contactId)
            .then(result => { if (current) setState({ key, links: result.links, error: '' }); })
            .catch(failure => { if (current) setState({ key, links: null, error: failure.message }); });
        return () => { current = false; };
    }, [ allowed, active, key, state.key, projectId, contactId ]);
    if (state.key !== key || !state.error && !state.links?.length) return null;
    return <ConversationDetailSection className="conversation-details-identity-links" title="Possibly the same customer">
        { state.error ? <p className="text-danger mb-0" role="alert">{ state.error }</p> : <>
            <p className="conversation-details-identity-links__note">Context only. Nothing is merged or sent.</p>
            { state.links.map(link => <ConversationDetailField key={ link.contact.id } icon="users" label={ proofLabel(link.contact.proof) }>
                <a href={ `/projects/${ projectId }/contacts/${ link.contact.id }` }>{ identityName(link.contact) }</a>
                <span className="conversation-detail-field__secondary-value">Linked by { link.actor_name || link.actor_id } · { new Date(link.created_at).toLocaleDateString() }</span>
            </ConversationDetailField>) }
        </> }
    </ConversationDetailSection>;
}

PossiblySameCustomer.propTypes = {
    projectId: PropTypes.string.isRequired,
    contact: PropTypes.object.isRequired,
    active: PropTypes.bool,
};
