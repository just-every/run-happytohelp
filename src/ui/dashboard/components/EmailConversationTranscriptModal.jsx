import React, { useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import Api from '../api';
import DialogHeader from './DialogHeader';

const normalize = value => value.trim().toLowerCase();
const validAddress = value => value.length <= 320 && /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value);
const outcomeText = {
    sent: 'Accepted by the email provider. Delivery is not yet confirmed.',
    suppressed: 'Local development: email was suppressed. No email was sent.',
    sending: 'The send is still pending. Check the same request again before sending another transcript.',
    uncertain: 'The delivery outcome is unknown. This request will not be sent again; reconcile it before starting another send.',
    failed: 'The provider rejected this email. This request will not be sent again.',
};

function EmailConversationTranscriptModal({ onHide, conversation }) {
    const [email, setEmail] = useState(conversation.contact.provided_email || conversation.contact.email || '');
    const [error, setError] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const storageKey = address => `h2h:transcript:${conversation.project_id}:${conversation.id}:${normalize(address)}`;
    const readIntent = address => {
        const stored = localStorage.getItem(storageKey(address));
        return stored ? JSON.parse(stored) : null;
    };
    const [outcome, setOutcome] = useState(() => {
        try { return readIntent(email)?.state || null; } catch { return null; }
    });

    const handleEmailTranscript = async event => {
        event.preventDefault();
        const address = normalize(email);
        if (!validAddress(address)) { setError('Enter one valid email address.'); return; }
        setIsLoading(true);
        setError(null);
        try {
            // Persist before the request: reopening, reloading and a lost response
            // all reuse this exact send and transcript frontier.
            const intent = readIntent(address) || {
                idempotencyKey: crypto.randomUUID(),
                revision: conversation.revision,
            };
            localStorage.setItem(storageKey(address), JSON.stringify(intent));
            const result = await Api.update(`/projects/${conversation.project_id}/conversations/${conversation.id}`, {
                send_transcript_to: address,
                idempotencyKey: intent.idempotencyKey,
                transcript_revision: intent.revision,
            });
            const state = result.transcript_delivery.state;
            localStorage.setItem(storageKey(address), JSON.stringify({ ...intent, state }));
            setOutcome(state);
        } catch (error) {
            setError(error.message || 'The outcome could not be checked. Retry uses the same send request.');
        } finally { setIsLoading(false); }
    };

    const changeEmail = event => {
        const value = event.target.value;
        setEmail(value);
        setError(null);
        try { setOutcome(readIntent(value)?.state || null); } catch { setOutcome(null); }
    };
    const newTranscript = () => {
        try {
            localStorage.removeItem(storageKey(email));
            setOutcome(null);
            setError(null);
        } catch { setError('The saved send request could not be cleared.'); }
    };
    const terminal = ['sent', 'suppressed', 'failed', 'uncertain'].includes(outcome);

    return (
        <Modal show onHide={onHide}>
            <DialogHeader closeButton><Modal.Title>Email Conversation Transcript</Modal.Title></DialogHeader>
            <Form onSubmit={handleEmailTranscript}>
                <Modal.Body>
                    <Form.Group className="form-group" controlId="form-transcript-email">
                        <Form.Label>Email</Form.Label>
                        <Form.Control type="email" required maxLength={320} disabled={isLoading} value={email} onChange={changeEmail} isInvalid={!!error} />
                        {error && <Form.Control.Feedback type="invalid" role="alert">{error}</Form.Control.Feedback>}
                    </Form.Group>
                    {outcome && <Alert className="mt-3" variant={outcome === 'sent' || outcome === 'suppressed' ? 'info' : 'warning'} role="status">{outcomeText[outcome] || `Email status: ${outcome}`}</Alert>}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" disabled={isLoading} onClick={onHide}>Close</Button>
                    {['sent', 'suppressed', 'failed'].includes(outcome) && <Button variant="secondary" onClick={newTranscript}>New transcript</Button>}
                    <Button variant="primary" type="submit" disabled={isLoading || terminal}>{isLoading ? 'Sending…' : outcome === 'sending' ? 'Check outcome' : 'Send'}</Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}

export default EmailConversationTranscriptModal;
