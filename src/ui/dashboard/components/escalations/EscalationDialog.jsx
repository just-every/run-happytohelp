import React, {useEffect, useId, useState, useRef} from 'react';
import {Modal, Overlay, Tooltip} from 'react-bootstrap';
import EscalationForm from './EscalationForm';
import {escalationRead} from './api';
import './escalations.css';
import './escalation-dialog.css';

function CloseEscalation({onClick}) {
    const target = useRef(null), timer = useRef(null), focused = useRef(false);
    const [show, setShow] = useState(false), id = useId();
    const clear = () => clearTimeout(timer.current);
    useEffect(() => () => clearTimeout(timer.current), []);
    return <><button ref={target} type="button" className="btn-close" aria-label="Close escalation" onClick={onClick}
        onMouseEnter={() => {clear(); timer.current = setTimeout(() => setShow(true), 300);}}
        onMouseLeave={() => {clear(); if (!focused.current) setShow(false);}}
        onFocus={() => {focused.current = true; clear(); setShow(true);}}
        onBlur={() => {focused.current = false; clear(); setShow(false);}}/>
        <Overlay target={target.current} show={show} placement="bottom" transition={false}><Tooltip id={id}>Close escalation</Tooltip></Overlay></>;
}

const customerVisible = message => !message.private && !message.is_private && !message.is_note && message.type !== 'note' && message.actor_role !== 'note';

/**
 * "+" › Escalate to engineering…: the selected-context form in a dialog. Ticket › Escalations keeps the links,
 * handoffs, customer updates to review and connections; it opens once an escalation is shared.
 */
export default function EscalationDialog({projectId, conversationId, onHide, onCreated}) {
    const titleId = useId();
    const base = `/api/escalations/projects/${encodeURIComponent(projectId)}`;
    const conversationBase = `${base}/conversations/${encodeURIComponent(conversationId)}`;
    const [state, setState] = useState({loading: true, messages: [], connections: [], error: '', connectionError: ''});
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let active = true;
        Promise.allSettled([escalationRead(conversationBase), escalationRead(`${base}/connections`)]).then(([ticket, providers]) => {
            if (!active) return;
            setState({
                loading: false,
                messages: ticket.status === 'fulfilled' ? (ticket.value.messages || []).filter(customerVisible) : [],
                connections: providers.status === 'fulfilled' ? providers.value : [],
                error: ticket.status === 'rejected' ? ticket.reason.message : '',
                connectionError: providers.status === 'rejected' ? providers.reason.message : '',
            });
        });
        return () => { active = false; };
    }, [base, conversationBase]);
    return <Modal show size="lg" onHide={busy ? undefined : onHide} aria-labelledby={titleId} className="escalation-dialog">
        <Modal.Header><Modal.Title id={titleId}>Escalate to engineering</Modal.Title>{!busy && <CloseEscalation onClick={onHide}/>}</Modal.Header>
        <Modal.Body>
            {state.loading && <p className="escalation-hint" role="status">Loading escalation context…</p>}
            {state.error && <p className="escalation-error" role="alert">{state.error}</p>}
            {state.connectionError && <p className="escalation-error" role="alert">Connections could not be loaded: {state.connectionError}</p>}
            {!state.loading && !state.error && !state.connectionError && <EscalationForm base={conversationBase} connections={state.connections} messages={state.messages} onBusyChange={setBusy} onChanged={onCreated}/>}
        </Modal.Body>
    </Modal>;
}
