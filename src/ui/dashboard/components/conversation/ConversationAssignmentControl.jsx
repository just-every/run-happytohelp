import React, { useContext, useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import OverlayTrigger from 'react-bootstrap/OverlayTrigger';
import Tooltip from 'react-bootstrap/Tooltip';
import useOnclickOutside from 'react-cool-onclickoutside';
import AgentAvatar from '../AgentAvatar';
import ReplyIcon from '../reply-icons/ReplyIcon';
import Api from '../../api';
import { ChatContext } from '../../contexts/ChatContext';

ConversationAssignmentControl.propTypes = {
    conversation: PropTypes.object.isRequired,
};

export default function ConversationAssignmentControl({ conversation }) {
    const [isOpen, setIsOpen] = useState(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState(null);
    const { agentsFor, aisFor, sendAction, updateConversation } = useContext(ChatContext);
    // Collaborators cannot reply, so conversations are not assigned to them.
    const agents = (agentsFor(conversation.project_id) || []).filter(agent => agent.access_role !== 'collaborator');
    const ais = aisFor(conversation.project_id) || [];
    const isAiAssigned = Boolean(conversation.ai_id);
    const assignmentName = (isAiAssigned ? conversation.ai?.name : conversation.agent?.name) || 'Unassigned';
    const dropdownRef = useOnclickOutside(() => setIsOpen(false));
    const toggleRef = useRef(null);
    useEffect(() => setError(null), [conversation.id]);

    // The assignment shown is always the server's: nothing changes until it accepts.
    const assign = (request, change, apply) => {
        setIsOpen(false);
        setPending(true);
        setError(null);
        request()
            .then(apply)
            .catch(failure => setError(`Could not ${change}: ${failure.message || 'the server refused the change'}. The conversation stays with ${assignmentName}.`))
            .finally(() => setPending(false));
    };

    const assignAgent = agentId => assign(
        () => Api.update(`/projects/${conversation.project_id}/conversations/${conversation.id}`, { ai_id: null, agent_id: agentId }),
        agentId ? `assign ${agents.find(agent => agent.id === agentId)?.name || 'that teammate'}` : 'unassign',
        data => updateConversation(data.data.id, data.data),
    );

    const assignAi = aiId => {
        const ai = ais.find(item => item.id === aiId);
        assign(
            () => sendAction('assignAi', { ai_id: aiId, conversation_id: conversation.id }, conversation.project_id),
            `hand over to ${ai?.name || 'the assistant'}`,
            () => updateConversation(conversation.id, { ai, ai_id: aiId, agent_id: aiId }),
        );
    };

    // Focus is on the toggle after a mouse click and on a menu item after keyboard navigation,
    // so Escape is handled on the wrapper that contains both.
    const handleKeyDown = event => {
        if (event.key !== 'Escape' || !isOpen) return;
        event.preventDefault();
        setIsOpen(false);
        toggleRef.current?.focus();
    };

    // Summary › Assignee: the server's assignment, changed from its menu.
    return (
        <div className="conversation-details-assignment">
            <div className={ `dropdown${isOpen ? ' show' : ''}` } onKeyDown={ handleKeyDown }>
                <OverlayTrigger placement="bottom" overlay={ <Tooltip id={ `${conversation.id}-assignment` }>Change assignment</Tooltip> }>
                    <button
                        ref={ toggleRef }
                        type="button"
                        className="btn btn-white dropdown-toggle"
                        aria-haspopup="menu"
                        aria-expanded={ isOpen }
                        aria-busy={ pending }
                        disabled={ pending }
                        aria-label={ `Assign conversation. Current assignment: ${assignmentName}` }
                        onClick={ () => setIsOpen(current => !current) }>
                        <span>{ assignmentName }</span>
                        <ReplyIcon name="chevron-right" className="conversation-details-assignment__chevron" />
                    </button>
                </OverlayTrigger>
                { isOpen && <div className="dropdown-menu p-1 show" ref={ dropdownRef } role="menu">
                    <button type="button" className="btn btn-link d-flex align-items-center" role="menuitem" onClick={ () => assignAgent(null) }>
                        Unassign
                    </button>
                    { agents.map(agent => agent.id === conversation.agent_id
                        ? <span className="btn is-selected d-flex align-items-center mt-1" key={ `agent-${agent.id}` }><AgentAvatar agent={ agent } className="avatar-xs" />{ agent.name }</span>
                        : <button type="button" className="btn btn-link d-flex align-items-center mt-1" role="menuitem" key={ `agent-${agent.id}` } onClick={ () => assignAgent(agent.id) }><AgentAvatar agent={ agent } className="avatar-xs" />{ agent.name }</button>
                    ) }
                    { ais.map(ai => ai.id === conversation.ai_id
                        ? <span className="btn is-selected d-flex align-items-center mt-1" key={ `ai-${ai.id}` }><AgentAvatar agent={ ai } className="avatar-xs" />{ ai.name }</span>
                        : <button type="button" className="btn btn-link d-flex align-items-center mt-1" role="menuitem" key={ `ai-${ai.id}` } onClick={ () => assignAi(ai.id) }><AgentAvatar agent={ ai } className="avatar-xs" />{ ai.name }</button>
                    ) }
                </div> }
            </div>
            { error && <p role="alert" className="text-danger">{ error }</p> }
        </div>
    );
}
