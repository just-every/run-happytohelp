import React, {useState} from 'react';
import {Alert,Button,Form,Modal} from 'react-bootstrap';
import Api from '../../api';

export default function MergeConversation({conversation,onHide,onChanged}) {
    const [source,setSource]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const base=`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}`;
    const run=async action=>{setBusy(true);setError('');try{await action()}catch(e){setError(e.message||'The merge could not be completed.')}finally{setBusy(false)}};
    const inspect=()=>run(async()=>{
        const sourceTicket=await Api.get(`/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(source.trim())}/ticket`);
        const targetTicket=await Api.get(`${base}/ticket`);
        const response=await Api.create(`${base}/merge/preview`,{source_id:source.trim(),source_version:sourceTicket.data.ticket_version,target_version:targetTicket.data.ticket_version});
        setPreview(response.data);
    });
    const apply=()=>run(async()=>{const result=await Api.create(`${base}/merge`,preview);await onChanged?.(result.data);onHide()});
    return <Modal show onHide={busy?undefined:onHide}>
        <Modal.Header closeButton={!busy}><Modal.Title>Merge duplicate tickets</Modal.Title></Modal.Header>
        <Modal.Body>
            {error&&<Alert variant="danger" role="alert">{error}</Alert>}
            <p>This ticket survives. The source becomes an alias with its history, files and private notes preserved.</p>
            <Form.Group controlId="merge-source-ticket"><Form.Label>Source ticket ID</Form.Label><Form.Control value={source} disabled={busy} onChange={e=>{setSource(e.target.value);setPreview(null)}}/></Form.Group>
            {preview&&<div className="mt-3">
                {preview.tickets.map(ticket=><p key={ticket.id}><strong>{ticket.id===preview.target_id?'Surviving':'Source'}: {ticket.id}</strong><br/>{ticket.messages} messages · {ticket.attachments} attachments · {ticket.private_notes} private notes<br/>Customer: {ticket.customer_name||ticket.customer_email||ticket.contact_id}{ticket.customer_name&&ticket.customer_email?` (${ticket.customer_email})`:''} · Channel: {ticket.channel} · Status: {ticket.status_category}</p>)}
                <p>{preview.private_notes}</p><p>{preview.channel_restrictions}</p><p>{preview.outcome_treatment}</p>
                <p>No customer notification is sent. Undo is available until a ticket changes or a partner thread advances.</p>
            </div>}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" disabled={busy} onClick={onHide}>Cancel</Button>{preview?<Button disabled={busy} onClick={apply}>Merge into this ticket</Button>:<Button disabled={busy||!source.trim()} onClick={inspect}>Preview merge</Button>}</Modal.Footer>
    </Modal>;
}
