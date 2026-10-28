import React from 'react';
import PropTypes from 'prop-types';
import { parseEmailRecipients } from '../EmailRecipients';
import { tooltip } from '../../../../modules/tooltip/tooltip';

export function senderLabel(sender, mailboxes) {
    if (!sender.mailboxId) return '';
    const mailbox = mailboxes.find(item => item.id === sender.mailboxId);
    return sender.fromAddress || mailbox?.sender_address || mailbox?.address || mailbox?.display_name || 'Chosen mailbox';
}

/** Cc, Bcc and From chips inside the reply card, once any is set. A chip reopens the editor; its × clears it. */
export default function RecipientChips({ cc, bcc, sender, mailboxes, onEdit, onClear, disabled }) {
    const chips = [
        { key: 'cc', label: 'Cc', value: parseEmailRecipients(cc).join(', ') },
        { key: 'bcc', label: 'Bcc', value: parseEmailRecipients(bcc).join(', ') },
        { key: 'from', label: 'From', value: senderLabel(sender, mailboxes) },
    ].filter(chip => chip.value);
    if (!chips.length) return null;
    return <ul className="conversation-recipient-chips" aria-label="Message recipients">
        { chips.map(chip => <li key={ chip.key } className="conversation-recipient-chip">
            <button type="button" className="conversation-recipient-chip__edit" disabled={ disabled } onClick={ onEdit } aria-label={ `Edit ${ chip.label }: ${ chip.value }` }>
                <span className="conversation-recipient-chip__label">{ chip.label }</span> <span className="conversation-recipient-chip__value">{ chip.value }</span>
            </button>
            <button type="button" className="conversation-recipient-chip__remove" disabled={ disabled } onClick={ () => onClear(chip.key) } { ...tooltip(`Remove ${ chip.label }`) }>
                <i className="fe fe-x" aria-hidden="true" />
            </button>
        </li>) }
    </ul>;
}

RecipientChips.propTypes = {
    cc: PropTypes.oneOfType([ PropTypes.string, PropTypes.array ]),
    bcc: PropTypes.oneOfType([ PropTypes.string, PropTypes.array ]),
    sender: PropTypes.object.isRequired,
    mailboxes: PropTypes.array.isRequired,
    onEdit: PropTypes.func.isRequired,
    onClear: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
};
