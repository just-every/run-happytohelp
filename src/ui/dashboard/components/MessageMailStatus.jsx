import React from 'react';
const labels = {
 sent: 'Email sent to provider · delivery not confirmed',
 suppressed: 'Email not sent · suppressed during local development',
 sending: 'Email send in progress',
 rate_limited: 'Email not sent · outbound notice rate limit reached; no automatic retry',
 consent_refused: 'Email not sent · requester unavailable or email notices disabled; no automatic retry',
 failed: 'Email failed · provider rejected the send',
 uncertain: 'Email outcome unknown · check your provider before resending',
 not_configured: 'Email not sent · configure an email provider',
 disabled: 'Email not sent · workspace email is disabled',
 no_recipient: 'Email not sent · visitor has not left an email',
 sender_address: 'Email not sent · the visitor’s address matches the reply sender’s',
 not_recorded: 'Email not sent · no attempt recorded',
};
export default function MessageMailStatus({status}) {
 if (!status) return null;
 return <small className="d-block text-muted mt-1" role="status">{labels[status.state] || 'Email status unknown'}</small>;
}
