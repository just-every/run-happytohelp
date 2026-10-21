import React, { useContext, useState } from 'react';
import PropTypes from 'prop-types';
import AddParticipantModal from '../AddParticipantModal';
import ReplyIcon from '../reply-icons/ReplyIcon';
import Api from '../../api';
import { ChatContext } from '../../contexts/ChatContext';

ConversationParticipantsControl.propTypes = {
    conversation: PropTypes.object.isRequired,
};

// An address may wrap before its @, never inside a word.
const address = email => { const at = String(email || '').lastIndexOf('@'); return at > 0 ? <>{ email.slice(0, at) }<wbr />{ email.slice(at) }</> : email; };

export default function ConversationParticipantsControl({ conversation }) {
    const [isAddParticipantModalVisible, setIsAddParticipantModalVisible] = useState(false);
    const [removing, setRemoving] = useState(null);
    const [error, setError] = useState(null);
    const { updateConversation } = useContext(ChatContext);
    const participants = conversation.participants || [];

    const removeParticipant = participantId => {
        setRemoving(participantId);
        setError(null);
        Api.remove(`/projects/${conversation.project_id}/conversations/${conversation.id}/participants/${participantId}`)
            .then(() => updateConversation(conversation.id, {
                participants: participants.filter(participant => participant.pivot.id !== participantId),
            }))
            .catch(error => setError(error.message || 'The recipient could not be removed.'))
            .finally(() => setRemoving(null));
    };

    // Summary › Recipients: the requester's reply address, then every added recipient with its remove control.
    const requester = conversation.contact?.provided_email || conversation.contact?.email;
    return (
        <div className="conversation-details-participants">
            { error && <p role="alert" className="text-danger">{ error }</p> }
            <ul className="conversation-details-participant-list">
                { requester && <li className="is-requester"><span title="Requester">{ address(requester) }</span></li> }
                { participants.map(participant => {
                    const email = participant.provided_email || participant.email;
                    return <li key={ `participant-${participant.id}` }>
                        <span>{ address(email) }</span>
                        <button type="button" className="btn btn-link" disabled={ removing !== null } aria-label={ `Remove ${email}` } onClick={ () => removeParticipant(participant.pivot.id) }>
                            <ReplyIcon name="x" />
                        </button>
                    </li>;
                }) }
            </ul>
            <button type="button" className="btn btn-link ticket-summary__add" aria-label="Add recipient" onClick={ () => setIsAddParticipantModalVisible(true) }><ReplyIcon name="plus" />Add</button>
            { isAddParticipantModalVisible && <AddParticipantModal conversation={ conversation } onHide={ () => setIsAddParticipantModalVisible(false) } /> }
        </div>
    );
}
