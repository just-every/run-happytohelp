import React from 'react';
import PropTypes from 'prop-types';
import { useCan } from '../ConversationAccess';
import useCollaboration from '../collaboration/useCollaboration';
import useHandleTimer from '../tickets/useHandleTimer';
import { StartMenuGroup, StartMenuItem } from './StartMenuItem';

/**
 * The start menu's Ticket group. Every row keeps today's permission check: conversations.follow (Follow), managing
 * followers (Internal CC), conversations.manage (Snooze, Merge, Escalate, Mark as problem, the timer) and
 * conversations.reply (Schedule reply, Forward). Ticket and workflow tools stay hidden in a demo project.
 */
export default function StartMenuTicket({ conversation, isDemo, onDialog, onOpenPanel }) {
    const projectId = conversation.project_id;
    const canManage = useCan(projectId, 'conversations.manage');
    const canReply = useCan(projectId, 'conversations.reply');
    const canFollow = useCan(projectId, 'conversations.follow');
    const collaboration = useCollaboration();
    const timer = useHandleTimer();
    const writable = !conversation.merged_into;
    const schedulable = !isDemo && !['closed', 'solved'].includes(conversation.status_category);
    const ticketTools = !isDemo && canManage;
    return <StartMenuGroup label="Ticket">
        { canFollow && <StartMenuItem icon="bell" checked={ collaboration.following } disabled={ !collaboration.loaded || collaboration.busy }
            onSelect={ () => (collaboration.following ? collaboration.unfollow() : collaboration.follow()) }>
            { collaboration.following ? 'Following' : 'Follow' }
        </StartMenuItem> }
        { canFollow && collaboration.canManageFollowers && <StartMenuItem icon="user-plus" dialog onSelect={ () => onDialog('followers') }>Internal CC…</StartMenuItem> }
        { schedulable && canManage && <StartMenuItem icon="clock" dialog onSelect={ () => onDialog('snooze') }>Snooze…</StartMenuItem> }
        { schedulable && canReply && <StartMenuItem icon="calendar" dialog onSelect={ () => onDialog('reply') }>Schedule reply…</StartMenuItem> }
        { writable && canManage && <StartMenuItem icon="git-merge" dialog onSelect={ () => onDialog('merge') }>Merge ticket…</StartMenuItem> }
        { writable && canReply && <StartMenuItem icon="share" dialog onSelect={ () => onDialog('forward') }>Forward to partner…</StartMenuItem> }
        { canManage && <StartMenuItem icon="git-pull-request" dialog onSelect={ () => onDialog('escalate') }>Escalate to engineering…</StartMenuItem> }
        { ticketTools && <StartMenuItem icon="alert-octagon" onSelect={ () => onOpenPanel('details', 'problem') }>Mark as problem…</StartMenuItem> }
        { ticketTools && <StartMenuItem icon={ timer.running ? 'stop-circle' : 'play-circle' } disabled={ !timer.loaded || timer.busy || (!timer.running && timer.stopped) }
            onSelect={ () => (timer.running ? timer.stop() : timer.start()) }>
            { timer.running ? 'Stop timer' : 'Start timer' }
        </StartMenuItem> }
    </StartMenuGroup>;
}

StartMenuTicket.propTypes = {
    conversation: PropTypes.object.isRequired,
    isDemo: PropTypes.bool,
    onDialog: PropTypes.func.isRequired,
    onOpenPanel: PropTypes.func.isRequired,
};
