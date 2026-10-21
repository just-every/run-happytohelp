import React, { useEffect, useId, useRef } from 'react';
import PropTypes from 'prop-types';
import EmailRecipients from '../EmailRecipients';
import EmailSender from '../../../native/pages/email/EmailSender';

/**
 * "CC, BCC and sender…": the reply's Cc and Bcc and its sending mailbox, edited beside the card and sent with the same
 * durable message command. A popover from 768 px, a bottom sheet on a phone. Escape or Done returns to the "+".
 */
export default function RecipientsPopover({ recipients, onRecipientsChange, sender, onSenderChange, mailboxes, senderError, disabled, onClose }) {
    const titleId = useId();
    const ref = useRef(null);
    const close = useRef(onClose);
    close.current = onClose;
    useEffect(() => {
        ref.current?.querySelector('select:not(:disabled), input:not(:disabled)')?.focus({ preventScroll: true });
        const outside = event => { if (ref.current && !ref.current.contains(event.target)) close.current(false); };
        document.addEventListener('mousedown', outside);
        document.addEventListener('touchstart', outside);
        return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('touchstart', outside); };
    }, []);
    const onKeyDown = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
    };
    return <div ref={ ref } className="conversation-recipients-popover" role="dialog" aria-modal="false" aria-labelledby={ titleId } onKeyDown={ onKeyDown }>
        <div className="conversation-recipients-popover__head">
            <h2 id={ titleId }>CC, BCC and sender</h2>
            <button type="button" className="btn-close" aria-label="Close CC, BCC and sender" onClick={ () => onClose(true) } />
        </div>
        <EmailSender defaultLabel="Use this ticket’s mailbox" mailboxes={ mailboxes } { ...sender } onChange={ onSenderChange } disabled={ disabled } />
        <EmailRecipients { ...recipients } onChange={ onRecipientsChange } disabled={ disabled } />
        { senderError && <p className="text-danger" role="alert">{ senderError }</p> }
        <div className="conversation-recipients-popover__actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={ () => onClose(true) }>Done</button>
        </div>
    </div>;
}

RecipientsPopover.propTypes = {
    recipients: PropTypes.object.isRequired,
    onRecipientsChange: PropTypes.func.isRequired,
    sender: PropTypes.object.isRequired,
    onSenderChange: PropTypes.func.isRequired,
    mailboxes: PropTypes.array.isRequired,
    senderError: PropTypes.string,
    disabled: PropTypes.bool,
    onClose: PropTypes.func.isRequired,
};
