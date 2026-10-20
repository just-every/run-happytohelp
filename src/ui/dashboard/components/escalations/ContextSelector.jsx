import React, {useId} from 'react';

export default function ContextSelector({messages, messageIds, attachmentIds, onChange, disabled}) {
    const id = useId();
    const toggle = (kind, value, checked) => {
        const selected = kind === 'message_ids' ? messageIds : attachmentIds;
        onChange(kind, checked ? [...selected, value] : selected.filter(item => item !== value));
    };
    return <fieldset className="escalation-context" disabled={disabled}>
        <legend>Choose context to share</legend>
        <p className="escalation-hint">Nothing is selected automatically. Messages and attachments are chosen separately. Private notes are excluded.</p>
        {messages.length === 0 && <p className="escalation-hint">No customer-visible messages to share.</p>}
        <div className="escalation-context-list">
            {messages.map(message => <div className="escalation-context-message" key={message.id}>
                <label className="escalation-choice" htmlFor={`${id}-message-${message.id}`}>
                    <input type="checkbox" id={`${id}-message-${message.id}`} checked={messageIds.includes(message.id)} onChange={event => toggle('message_ids', message.id, event.target.checked)}/>
                    <span><span className="escalation-message-content">{message.content || 'Message without text'}</span>{message.created_at && <time className="escalation-hint">{new Date(message.created_at).toLocaleString()}</time>}</span>
                </label>
                {message.attachments.map(attachment => <label className="escalation-choice escalation-attachment" key={attachment.id} htmlFor={`${id}-file-${attachment.id}`}>
                    <input type="checkbox" id={`${id}-file-${attachment.id}`} checked={attachmentIds.includes(attachment.id)} onChange={event => toggle('attachment_ids', attachment.id, event.target.checked)}/>
                    <span>{attachment.filename}{Number.isFinite(attachment.size) && <small> · {Math.ceil(attachment.size / 1024)} KB</small>}</span>
                </label>)}
            </div>)}
        </div>
        <p className="escalation-hint">Shared attachment download links expire after seven days.</p>
    </fieldset>;
}
