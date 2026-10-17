import React, { useContext } from 'react';
import { DashboardSettingsContext } from '../../native/dashboard-state';
import '../styles/components/ConversationAccess.scss';

/** Whether the signed-in member's role in this workspace allows a permission; true where roles are not known (demo, widget). */
export function useCan(projectId, permission) {
    const access = useContext(DashboardSettingsContext)?.projects?.[projectId]?.access;
    return !access || access.permissions.includes(permission);
}

/** In place of the reply box, for a role that cannot reply to customers (a collaborator). */
export function NotesOnlyComposer({ onAddNote }) {
    return <div className="conversation-notes-only" role="note">
        <p>You can read this conversation, add internal notes and follow it. Only teammates who can reply send messages to the customer.</p>
        <button type="button" className="btn btn-primary" onClick={onAddNote}>Add internal note</button>
    </div>;
}
