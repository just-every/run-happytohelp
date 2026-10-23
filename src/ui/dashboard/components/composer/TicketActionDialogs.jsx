import React, { useContext, useId } from 'react';
import PropTypes from 'prop-types';
import { Modal } from 'react-bootstrap';
import { useDashboardSettings } from '../../../native/dashboard-state';
import { useUnsavedChanges } from '../../../native/NavigationGuard';
import { ChatContext } from '../../contexts/ChatContext';
import MergeConversation from '../conversation-actions/MergeConversation';
import ForwardConversation from '../conversation-actions/ForwardConversation';
import FollowersDialog from '../collaboration/FollowersDialog';
import EscalationDialog from '../escalations/EscalationDialog';
import ScheduleForm from '../workflows/ScheduleForm';
import './ticket-action-dialogs.css';
import DialogHeader from '../DialogHeader';

/** Snooze… and Schedule reply…: today's schedule form, in a dialog. */
function ScheduleDialog({ kind, conversation, onHide, onSaved }) {
    const titleId = useId();
    const settings = useDashboardSettings();
    const { agentsFor } = useContext(ChatContext);
    const { markDirty, markSaved } = useUnsavedChanges();
    const agents = (agentsFor(conversation.project_id) || []).filter(row => row.access_role !== 'collaborator');
    const close = () => { markSaved(); onHide(); };
    return <Modal show onHide={ close } aria-labelledby={ titleId } className="schedule-dialog">
        <DialogHeader closeButton><Modal.Title id={ titleId }>{ kind === 'reply' ? 'Schedule a reply' : 'Snooze ticket' }</Modal.Title></DialogHeader>
        <Modal.Body>
            <ScheduleForm schedule={ { kind } } conversation={ conversation } agents={ agents } currentAgentId={ settings.currentAgent?.id }
                changed={ markDirty } clean={ markSaved } onCancel={ close } onSaved={ async () => { onHide(); await onSaved(); } } />
        </Modal.Body>
    </Modal>;
}

/**
 * The dialogs behind the start menu's Ticket rows: Merge, Forward, Internal CC, Snooze, Schedule reply and Escalate.
 * Merge and Forward are today's dialogs, unchanged.
 */
export default function TicketActionDialogs({ dialog, onHide, conversation, messages, onChanged, onEscalated }) {
    if (dialog === 'merge') return <MergeConversation conversation={ conversation } onHide={ onHide } onChanged={ onChanged } />;
    if (dialog === 'forward') return <ForwardConversation conversation={ conversation } messages={ messages } onHide={ onHide } onChanged={ onChanged } />;
    if (dialog === 'followers') return <FollowersDialog onHide={ onHide } />;
    if (dialog === 'escalate') return <EscalationDialog projectId={ conversation.project_id } conversationId={ conversation.id } onHide={ onHide } onCreated={ async () => { onHide(); await onEscalated(); } } />;
    if (dialog === 'snooze' || dialog === 'reply') return <ScheduleDialog kind={ dialog } conversation={ conversation } onHide={ onHide } onSaved={ onChanged } />;
    return null;
}

TicketActionDialogs.propTypes = {
    dialog: PropTypes.oneOf([ 'merge', 'forward', 'followers', 'escalate', 'snooze', 'reply' ]),
    onHide: PropTypes.func.isRequired,
    conversation: PropTypes.object.isRequired,
    messages: PropTypes.array.isRequired,
    onChanged: PropTypes.func.isRequired,
    onEscalated: PropTypes.func.isRequired,
};
