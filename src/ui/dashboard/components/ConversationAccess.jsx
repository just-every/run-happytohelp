import React, { useContext } from 'react';
import PropTypes from 'prop-types';
import { DashboardSettingsContext } from '../../native/dashboard-state';
import StartMenu from './composer/StartMenu';
import StartMenuTicket from './composer/StartMenuTicket';
import { StartMenuGroup, StartMenuItem } from './composer/StartMenuItem';
import '../styles/components/ConversationAccess.scss';

/** Whether the signed-in member's role in this workspace allows a permission; true where roles are not known (demo, widget). */
export function useCan(projectId, permission) {
    const access = useContext(DashboardSettingsContext)?.projects?.[projectId]?.access;
    return !access || access.permissions.includes(permission);
}

/**
 * In place of the reply box, for a role that cannot reply to customers (a collaborator). Its "+" holds only what the
 * role may use: Internal note, and the Ticket rows its permissions allow (Follow and, when permitted, Internal CC).
 */
export function NotesOnlyComposer({ onAddNote, presence, noteDraft, draftError, ticketMenu }) {
    return <div className="conversation-notes-only" role="note">
        { presence }
        { noteDraft }
        { draftError && <p className="conversation-composer__error" role="alert">{ draftError }</p> }
        <div className="conversation-notes-only__row">
            <p>You can read this conversation, add internal notes and follow it. Only teammates who can reply send messages to the customer.</p>
            <div className="conversation-notes-only__actions">
                <button type="button" className="btn btn-primary" onClick={ onAddNote }>Add internal note</button>
                <StartMenu id="conversation-notes-tools" main={ <>
                    <StartMenuGroup label="Notes">
                        <StartMenuItem icon="lock" onSelect={ onAddNote } dialog>Internal note</StartMenuItem>
                    </StartMenuGroup>
                    <StartMenuTicket { ...ticketMenu } />
                </> } />
            </div>
        </div>
    </div>;
}

NotesOnlyComposer.propTypes = {
    onAddNote: PropTypes.func.isRequired,
    presence: PropTypes.node,
    noteDraft: PropTypes.node,
    draftError: PropTypes.string,
    ticketMenu: PropTypes.object.isRequired,
};
