import React, {useContext} from 'react';
import AppContext from './context/AppContext';
import {ConnectContext} from './context/ConnectContext';
import {backAt, humanResponseTime} from '../availability-text.js';

// Outside the team's hours, or with "Accept new conversations" off: say so, say when the team is back, and say where
// the reply will reach the visitor. The conversation is still created; the email field opens below (SendMessage).
export default function AwayNotice() {
    const context = useContext(AppContext);
    const {conversationSettings, contact} = useContext(ConnectContext);
    const availability = conversationSettings.availability;
    if (availability?.available !== false) return null;
    const text = context.text.away, back = backAt(availability.opensAt);
    const mail = Boolean(conversationSettings.mailMode) && conversationSettings.mailMode !== 'unavailable';
    return <div className="happytohelp-away-notice" role="status">
        <strong>{text.title}</strong>
        <span>{back ? text.back.replace('{when}', back) : humanResponseTime(context.text)}</span>
        {mail && <span>{contact.email ? text.email_known.replace('{email}', contact.email) : text.email_ask}</span>}
    </div>;
}
