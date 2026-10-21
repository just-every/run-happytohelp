import React from 'react';
import PropTypes from 'prop-types';
import { useReplySuggestions } from '../contexts/ConversationSuggestionsContext';
import StartMenu from './composer/StartMenu';
import StartMenuTicket from './composer/StartMenuTicket';
import { StartMenuGroup, StartMenuItem } from './composer/StartMenuItem';

const rewriteTools = [
    { name: 'improve', label: 'Improve writing', icon: 'star' },
    { name: 'extend', label: 'Make longer', icon: 'align-left' },
    { name: 'shorten', label: 'Make shorter', icon: 'align-center' },
];

/**
 * The reply card's "+" start menu: Reply, Write with AI and Draft in the first column, Ticket in the second, and
 * Send & close as its footer. Reply rows wait while the field is locked (an AI draft or a final ticket); ticket
 * rows stay available, as their controls were before they moved here.
 */
export default function ConversationComposerTools({ disabled, locked, hasHelper, canSend, canClose, onAttach, onSaved, onArticle, onNote, onRecipients, onSendAndClose, ticketMenu }) {
    const { canRunTools, canUndo, canRedo, runTool, undo, redo, suggestions } = useReplySuggestions();
    const historyDisabled = locked || hasHelper || suggestions.loading;

    return <StartMenu
        id="conversation-composer-tools"
        disabled={ disabled }
        main={ <>
            <StartMenuGroup label="Reply">
                <StartMenuItem icon="paperclip" onSelect={ onAttach } disabled={ locked || hasHelper }>Attach file</StartMenuItem>
                <StartMenuItem icon="bookmark" onSelect={ onSaved } disabled={ locked }>{ hasHelper ? 'Back to reply' : 'Saved replies' }</StartMenuItem>
                <StartMenuItem icon="file-text" onSelect={ onArticle } disabled={ locked }>Help articles</StartMenuItem>
                <StartMenuItem icon="lock" onSelect={ onNote } disabled={ locked } dialog>Internal note</StartMenuItem>
                <StartMenuItem icon="users" onSelect={ onRecipients } disabled={ locked } dialog>CC, BCC and sender…</StartMenuItem>
            </StartMenuGroup>
            <StartMenuGroup label="Write with AI">
                { rewriteTools.map(tool => <StartMenuItem key={ tool.name } icon={ tool.icon } onSelect={ () => runTool(tool.name) } disabled={ locked || !canRunTools }>{ tool.label }</StartMenuItem>) }
            </StartMenuGroup>
            <StartMenuGroup label="Draft">
                <StartMenuItem icon="corner-up-left" onSelect={ undo } disabled={ historyDisabled || !canUndo }>Undo</StartMenuItem>
                <StartMenuItem icon="corner-up-right" onSelect={ redo } disabled={ historyDisabled || !canRedo }>Redo</StartMenuItem>
            </StartMenuGroup>
        </> }
        aside={ <StartMenuTicket { ...ticketMenu } /> }
        footer={ canClose && <StartMenuItem icon="check-circle" onSelect={ onSendAndClose } disabled={ !canSend }>Send &amp; close</StartMenuItem> } />;
}

ConversationComposerTools.propTypes = {
    disabled: PropTypes.bool,
    locked: PropTypes.bool,
    hasHelper: PropTypes.bool,
    canSend: PropTypes.bool,
    canClose: PropTypes.bool,
    onAttach: PropTypes.func.isRequired,
    onSaved: PropTypes.func.isRequired,
    onArticle: PropTypes.func,
    onNote: PropTypes.func.isRequired,
    onRecipients: PropTypes.func.isRequired,
    onSendAndClose: PropTypes.func.isRequired,
    ticketMenu: PropTypes.object.isRequired,
};
